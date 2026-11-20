import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { ownerFilter } from '../../common/auth/ownership';
import { BookingStatus, BookingType } from '../../common/bookings/booking-status';
import { PLATFORM_CURRENCY } from '../../common/money/money';
import { PaymentsService } from '../../payments/payments.service';
import { StripeService } from '../../payments/stripe.service';
import { ChangeFlightDto } from './dto/change-flight.dto';
import { fareFor } from './flight-booking-pricing';
import { SeatInventoryService, SeatChange } from '../seat-inventory/seat-inventory.service';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../schemas/flight-booking.schema';
import { Flight, FlightDocument, FlightStatus } from '../schemas/flight.schema';

const money = (value: Types.Decimal128 | string): Decimal =>
  new Decimal(value.toString());
const fixed = (value: Decimal): string => value.toDecimalPlaces(2).toFixed(2);
const decimal128 = (value: Decimal): Types.Decimal128 =>
  Types.Decimal128.fromString(fixed(value));

/**
 * FLT-27 (bonus): move one segment of a CONFIRMED booking to another flight on
 * the same route and cabin. The fare difference is computed per passenger
 * with the same rule as the booking (infants pay 10%, FLT-12): a higher fare
 * opens a PaymentIntent and the change waits for it, a lower one is refunded.
 */
@Injectable()
export class ChangeFlightService {
  private readonly logger = new Logger(ChangeFlightService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBookingDocument>,
    @InjectModel(Flight.name)
    private readonly flightModel: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
    @InjectConnection() private readonly connection: Connection,
    private readonly seats: SeatInventoryService,
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
  ) {}

  /** FLT-27: same route + cabin, with the fare difference charged or refunded. */
  async request(user: AuthenticatedUser, bookingId: string, dto: ChangeFlightDto) {
    const booking = await this.owned(user, bookingId);
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException({
        code: 'BOOKING_NOT_CONFIRMED',
        message: 'Only a Confirmed booking can be changed',
      });
    }
    if (booking.pendingChange) {
      throw new ConflictException({
        code: 'CHANGE_ALREADY_PENDING',
        message: 'Finish the pending flight change first',
      });
    }

    const index = dto.segmentIndex ?? 0;
    const segment = booking.segments[index];
    if (!segment) {
      throw new NotFoundException({ code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' });
    }
    if (segment.departureAtUtc.getTime() <= Date.now()) {
      throw new ConflictException({
        code: 'SEGMENT_ALREADY_DEPARTED',
        message: 'A flight that has already departed cannot be changed',
      });
    }
    if (segment.flightId.toString() === dto.newFlightId) {
      throw new BadRequestException({
        code: 'SAME_FLIGHT',
        message: 'The booking is already on this flight',
      });
    }

    const next = await this.bookableFlight(dto.newFlightId);
    if (
      next.departureAirportId !== segment.departureAirportId ||
      next.arrivalAirportId !== segment.arrivalAirportId
    ) {
      throw new BadRequestException({
        code: 'DIFFERENT_ROUTE',
        message: 'The new flight must have the same route',
      });
    }
    this.assertKeepsTripOrder(booking, index, next);

    const newCabin = next.cabinInventory.find(
      (c) => c.category === segment.cabinCategory,
    );
    if (!newCabin) {
      throw new BadRequestException({
        code: 'CABIN_NOT_FOUND',
        message: 'The new flight has no such cabin',
      });
    }
    const free = newCabin.totalSeats - newCabin.bookedSeats - newCabin.heldSeats;
    if (free < segment.seatsRequired) {
      throw new ConflictException({
        code: 'SEATS_UNAVAILABLE',
        message: 'The new flight has too few seats left',
      });
    }

    const difference = this.fareDifference(booking, segment.cabinPrice, newCabin.price);
    const currency = booking.priceSnapshot?.currency || PLATFORM_CURRENCY;

    if (difference.isZero()) {
      await this.apply(booking, index, next, newCabin.price, difference);
      return { requiresPayment: false, applied: true, amountDifference: '0.00', currency };
    }

    if (difference.isNegative()) {
      // The cheaper flight is taken first: the seats move and the booking
      // records the new price whether or not Stripe answers right away.
      await this.apply(booking, index, next, newCabin.price, difference);
      const refunded = await this.refundDifference(bookingId, dto.newFlightId, difference.abs());
      return {
        requiresPayment: false,
        applied: true,
        amountDifference: fixed(difference),
        currency,
        refunded,
      };
    }

    const intent = await this.stripe.createPaymentIntent({
      amount: fixed(difference),
      idempotencyKey: `flt27-${bookingId}-${index}-${dto.newFlightId}`,
      bookingType: BookingType.FLIGHT,
      bookingId,
      userId: user.userId,
    });
    // Conditional: two requests racing for the same booking open at most one
    // pending change.
    const saved = await this.bookingModel
      .updateOne(
        { _id: booking._id, status: BookingStatus.CONFIRMED, pendingChange: null },
        {
          $set: {
            pendingChange: {
              newFlightId: next._id,
              segmentIndex: index,
              newCabinPrice: newCabin.price,
              amountDifference: fixed(difference),
              currency,
              stripePaymentIntentId: intent.id,
              requestedAt: new Date(),
            },
          },
        },
      )
      .exec();
    if (saved.modifiedCount === 0) {
      throw new ConflictException({
        code: 'CHANGE_ALREADY_PENDING',
        message: 'Finish the pending flight change first',
      });
    }
    return {
      requiresPayment: true,
      applied: false,
      amountDifference: fixed(difference),
      currency,
      clientSecret: intent.client_secret,
      stripePaymentIntentId: intent.id,
    };
  }

  /** FLT-27: apply a change once its fare-difference intent succeeded. */
  async applyPaid(user: AuthenticatedUser, bookingId: string) {
    const booking = await this.owned(user, bookingId);
    const pending = booking.pendingChange;
    if (!pending) {
      throw new ConflictException({
        code: 'NO_PENDING_CHANGE',
        message: 'No flight change is pending',
      });
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException({
        code: 'BOOKING_NOT_CONFIRMED',
        message: 'Only a Confirmed booking can be changed',
      });
    }
    const intent = await this.stripe.retrievePaymentIntent(
      pending.stripePaymentIntentId,
    );
    if (intent.status !== 'succeeded') {
      throw new ConflictException({
        code: 'PAYMENT_NOT_SUCCEEDED',
        message: 'The fare difference has not been paid yet',
      });
    }
    // The flight must still be bookable; the price is the one that was paid.
    const next = await this.bookableFlight(pending.newFlightId.toString());
    this.assertKeepsTripOrder(booking, pending.segmentIndex, next);
    await this.apply(
      booking,
      pending.segmentIndex,
      next,
      pending.newCabinPrice,
      money(pending.amountDifference),
    );
    return { applied: true, bookingId: String(booking._id) };
  }

  private async owned(user: AuthenticatedUser, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });
    }
    const booking = await this.bookingModel
      .findOne({ _id: id, ...ownerFilter(user) })
      .exec();
    if (!booking) {
      throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });
    }
    return booking;
  }

  /** A SCHEDULED flight, in the future, of an ACTIVE airline; else 404. */
  private async bookableFlight(id: string): Promise<FlightDocument> {
    const notFound = new NotFoundException({
      code: 'FLIGHT_NOT_FOUND',
      message: 'Flight not found',
    });
    if (!Types.ObjectId.isValid(id)) throw notFound;
    const next = await this.flightModel.findById(id).exec();
    if (
      !next ||
      next.status !== FlightStatus.SCHEDULED ||
      next.departureAtUtc.getTime() <= Date.now()
    ) {
      throw notFound;
    }
    const airline = await this.airlineModel
      .exists({ _id: next.airlineId, status: AirlineStatus.ACTIVE })
      .exec();
    if (!airline) throw notFound; // ACC-15: a deactivated airline cannot be booked.
    return next;
  }

  /** A round trip must still land before the return leaves. */
  private assertKeepsTripOrder(
    booking: FlightBookingDocument,
    index: number,
    next: FlightDocument,
  ): void {
    const outbound = index === 0 ? next : booking.segments[0];
    const inbound = index === 1 ? next : booking.segments[1];
    if (inbound && outbound.arrivalAtUtc.getTime() >= inbound.departureAtUtc.getTime()) {
      throw new BadRequestException({
        code: 'TRIP_ORDER_INVALID',
        message: 'The outbound flight must arrive before the return flight departs',
      });
    }
  }

  /** Sum over passengers of (new fare - old fare) on one segment (FLT-12 rule). */
  private fareDifference(
    booking: FlightBookingDocument,
    oldPrice: Types.Decimal128,
    newPrice: Types.Decimal128,
  ): Decimal {
    return booking.passengers.reduce(
      (sum, p) =>
        sum
          .plus(fareFor(p.passengerType, newPrice.toString()))
          .minus(fareFor(p.passengerType, oldPrice.toString())),
      new Decimal(0),
    );
  }

  private async refundDifference(
    bookingId: string,
    newFlightId: string,
    amount: Decimal,
  ): Promise<boolean> {
    const payment = await this.payments.findSucceededForBooking(
      BookingType.FLIGHT,
      bookingId,
    );
    if (!payment?.stripePaymentIntentId) return false;
    try {
      await this.stripe.createRefund({
        stripePaymentIntentId: payment.stripePaymentIntentId,
        amount: fixed(amount),
        idempotencyKey: `flt27-refund-${bookingId}-${newFlightId}`,
        bookingId,
      });
      return true;
    } catch (error) {
      // The change already applied; the refund is logged for a retry.
      this.logger.error(
        `FLT-27 refund of ${fixed(amount)} for booking ${bookingId} failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * Moves the seats and rewrites the segment, every passenger's fare and the
   * booking totals in one transaction, so a booking never shows the new
   * flight with the old price (FLT-26 refunds read these totals).
   */
  private async apply(
    booking: FlightBookingDocument,
    index: number,
    next: FlightDocument,
    price: Types.Decimal128,
    difference: Decimal,
  ): Promise<void> {
    const segment = booking.segments[index];
    const oldPrice = segment.cabinPrice;
    const oldSeats: SeatChange = {
      flightId: segment.flightId,
      category: segment.cabinCategory,
      seats: segment.seatsRequired,
    };
    const newSeats: SeatChange = {
      flightId: next._id,
      category: segment.cabinCategory,
      seats: segment.seatsRequired,
    };
    const cabin = next.cabinInventory.find(
      (c) => c.category === segment.cabinCategory,
    );
    if (!cabin) {
      throw new BadRequestException({
        code: 'CABIN_NOT_FOUND',
        message: 'The new flight has no such cabin',
      });
    }

    await this.connection.transaction(async (session) => {
      await this.seats.hold(newSeats, session);
      await this.seats.convertHeldToBooked(newSeats, session);
      await this.seats.releaseBooked(oldSeats, session);

      segment.flightId = next._id;
      segment.airlineId = next.airlineId;
      segment.flightNumber = next.flightNumber;
      segment.departureAirportId = next.departureAirportId;
      segment.arrivalAirportId = next.arrivalAirportId;
      segment.departureAtUtc = next.departureAtUtc;
      segment.arrivalAtUtc = next.arrivalAtUtc;
      segment.cabinPrice = price;
      segment.freeBaggageCount = cabin.freeBaggageCount;
      segment.maxBagWeightKg = cabin.maxBagWeightKg;
      segment.seatAssignments = [];
      for (const passenger of booking.passengers) {
        passenger.fareAmount = decimal128(
          money(passenger.fareAmount)
            .plus(fareFor(passenger.passengerType, price.toString()))
            .minus(fareFor(passenger.passengerType, oldPrice.toString())),
        );
      }
      booking.priceSnapshot.subtotal = decimal128(
        money(booking.priceSnapshot.subtotal).plus(difference),
      );
      booking.priceSnapshot.total = decimal128(
        money(booking.priceSnapshot.total).plus(difference),
      );
      booking.pendingChange = null;
      await booking.save({ session });
    });
  }
}
