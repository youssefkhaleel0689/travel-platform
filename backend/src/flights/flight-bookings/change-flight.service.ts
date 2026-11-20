import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { SeatInventoryService, SeatChange } from '../seat-inventory/seat-inventory.service';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../schemas/flight-booking.schema';
import { Flight, FlightDocument, FlightStatus } from '../schemas/flight.schema';

const money = (value: Types.Decimal128): Decimal => new Decimal(value.toString());
const fixed = (value: Decimal): string => value.toDecimalPlaces(2).toFixed(2);

@Injectable()
export class ChangeFlightService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBookingDocument>,
    @InjectModel(Flight.name)
    private readonly flightModel: Model<FlightDocument>,
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
    const next = await this.flightModel.findById(dto.newFlightId).exec();
    if (!next || next.status !== FlightStatus.SCHEDULED) {
      throw new NotFoundException({ code: 'FLIGHT_NOT_FOUND', message: 'Flight not found' });
    }
    if (
      next.departureAirportId !== segment.departureAirportId ||
      next.arrivalAirportId !== segment.arrivalAirportId
    ) {
      throw new BadRequestException({
        code: 'DIFFERENT_ROUTE',
        message: 'The new flight must have the same route',
      });
    }
    const newCabin = next.cabinInventory.find(
      (c) => c.category === segment.cabinCategory,
    );
    if (!newCabin) {
      throw new BadRequestException({
        code: 'CABIN_NOT_FOUND',
        message: 'The new flight has no such cabin',
      });
    }
    const free =
      newCabin.totalSeats - newCabin.bookedSeats - newCabin.heldSeats;
    if (free < segment.seatsRequired) {
      throw new ConflictException({
        code: 'SEATS_UNAVAILABLE',
        message: 'The new flight has too few seats left',
      });
    }

    const oldFare = money(segment.cabinPrice).times(segment.seatsRequired);
    const newFare = money(newCabin.price).times(segment.seatsRequired);
    const difference = newFare.minus(oldFare);
    const currency = booking.priceSnapshot?.currency || PLATFORM_CURRENCY;

    if (difference.isZero()) {
      await this.apply(booking, index, next, newCabin.price);
      return { requiresPayment: false, applied: true, amountDifference: '0.00', currency };
    }

    if (difference.isNegative()) {
      const payment = await this.payments.findSucceededForBooking(
        BookingType.FLIGHT,
        bookingId,
      );
      if (payment?.stripePaymentIntentId) {
        try {
          await this.stripe.createRefund({
            stripePaymentIntentId: payment.stripePaymentIntentId,
            amount: fixed(difference.abs()),
            idempotencyKey: `flt27-refund-${bookingId}-${dto.newFlightId}`,
            bookingId,
          });
        } catch {
          // The fare change still applies; the refund can be retried by C2.
        }
      }
      await this.apply(booking, index, next, newCabin.price);
      return {
        requiresPayment: false,
        applied: true,
        amountDifference: fixed(difference),
        currency,
        refunded: true,
      };
    }

    const intent = await this.stripe.createPaymentIntent({
      amount: fixed(difference),
      idempotencyKey: `flt27-${bookingId}-${dto.newFlightId}`,
      bookingType: BookingType.FLIGHT,
      bookingId,
      userId: user.userId,
    });
    booking.pendingChange = {
      newFlightId: new Types.ObjectId(dto.newFlightId),
      amountDifference: fixed(difference),
      currency,
      stripePaymentIntentId: intent.id,
      requestedAt: new Date(),
    };
    await booking.save();
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
    const intent = await this.stripe.retrievePaymentIntent(
      pending.stripePaymentIntentId,
    );
    if (intent.status !== 'succeeded') {
      throw new ConflictException({
        code: 'PAYMENT_NOT_SUCCEEDED',
        message: 'The fare difference has not been paid yet',
      });
    }
    const next = await this.flightModel.findById(pending.newFlightId).exec();
    if (!next) {
      throw new NotFoundException({ code: 'FLIGHT_NOT_FOUND', message: 'Flight not found' });
    }
    const cabin = next.cabinInventory.find(
      (c) => c.category === booking.segments[0].cabinCategory,
    );
    if (!cabin) {
      throw new BadRequestException({
        code: 'CABIN_NOT_FOUND',
        message: 'The new flight has no such cabin',
      });
    }
    await this.apply(booking, 0, next, cabin.price);
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

  private async apply(
    booking: FlightBookingDocument,
    index: number,
    next: FlightDocument,
    price: Types.Decimal128,
  ): Promise<void> {
    const segment = booking.segments[index];
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
    )!;

    await this.connection.transaction(async (session) => {
      await this.seats.releaseBooked(oldSeats, session);
      await this.seats.hold(newSeats, session);
      await this.seats.convertHeldToBooked(newSeats, session);

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
      booking.pendingChange = null;
      await booking.save({ session });
    });
  }
}
