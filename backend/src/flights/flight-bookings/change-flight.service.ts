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
import {
  BookingStatus,
  BookingType,
} from '../../common/bookings/booking-status';
import { HOLD_MINUTES, PLATFORM_CURRENCY } from '../../common/money/money';
import { PaymentsService } from '../../payments/payments.service';
import { RefundStatus } from '../../payments/refund-status.enum';
import { RefundsService } from '../../payments/refunds.service';
import { StripeService } from '../../payments/stripe.service';
import { ChangeFlightDto } from './dto/change-flight.dto';
import { fareFor } from './flight-booking-pricing';
import {
  SeatInventoryService,
  SeatChange,
} from '../seat-inventory/seat-inventory.service';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import {
  FlightBooking,
  FlightBookingDocument,
  PendingFlightChange,
} from '../schemas/flight-booking.schema';
import { Flight, FlightDocument, FlightStatus } from '../schemas/flight.schema';

const money = (value: Types.Decimal128 | string): Decimal =>
  new Decimal(value.toString());
const fixed = (value: Decimal): string => value.toDecimalPlaces(2).toFixed(2);
const decimal128 = (value: Decimal): Types.Decimal128 =>
  Types.Decimal128.fromString(fixed(value));

const HOLD_MS = HOLD_MINUTES * 60 * 1000;
// How many expired changes one run of the hold-expiry job settles.
const EXPIRY_BATCH_SIZE = 100;

type Cabin = FlightDocument['cabinInventory'][number];

/** What a settled change did, for the hold-expiry job's log. */
export type SettledChange = 'applied' | 'refunded' | 'released' | 'waiting';

function changedMeanwhile(): ConflictException {
  return new ConflictException({
    code: 'BOOKING_CHANGED',
    message: 'The booking changed at the same time; reload it and try again',
  });
}

function alreadyPending(): ConflictException {
  return new ConflictException({
    code: 'CHANGE_ALREADY_PENDING',
    message: 'Finish the pending flight change first',
  });
}

/**
 * FLT-27 (bonus): move one segment of a CONFIRMED booking to another flight on
 * the same route and cabin. The fare difference is computed per passenger
 * with the same rule as the booking (infants pay 10%, FLT-12).
 *
 * - Same or lower fare: applied at once, and a lower fare's difference is
 *   refunded through RefundsService, so it is recorded and notified (PAY-03).
 * - Higher fare: the new seats are held for HOLD_MINUTES while the user pays
 *   the difference (a PaymentIntent), and the change waits. It is applied by
 *   POST .../change-flight/apply, or by the hold-expiry job once the hold has
 *   ended if the user paid but never called it. An unpaid change is released.
 *
 * Every step that moves seats does so in one transaction with ONE conditional
 * update of the booking, whose filter says what the booking must still look
 * like (still on the old flight, the same pending payment). A second request
 * for the same change, a double click or a retry, finds nothing to update and
 * is refused with 409, and its seat moves are rolled back with it.
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
    private readonly refunds: RefundsService,
  ) {}

  /** FLT-27: same route + cabin, with the fare difference charged or refunded. */
  async request(
    user: AuthenticatedUser,
    bookingId: string,
    dto: ChangeFlightDto,
  ) {
    const booking = await this.owned(user, bookingId);
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException({
        code: 'BOOKING_NOT_CONFIRMED',
        message: 'Only a Confirmed booking can be changed',
      });
    }
    if (booking.pendingChange) {
      throw alreadyPending();
    }

    const index = dto.segmentIndex ?? 0;
    const segment = booking.segments[index];
    if (!segment) {
      throw new NotFoundException({
        code: 'SEGMENT_NOT_FOUND',
        message: 'Segment not found',
      });
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

    const newCabin = this.cabinOf(next, segment.cabinCategory);
    // A quick answer for the common case; the seat hold below is the real
    // check, inside the transaction.
    const free =
      newCabin.totalSeats - newCabin.bookedSeats - newCabin.heldSeats;
    if (free < segment.seatsRequired) {
      throw new ConflictException({
        code: 'SEATS_UNAVAILABLE',
        message: 'The new flight has too few seats left',
      });
    }

    const difference = this.fareDifference(
      booking,
      segment.cabinPrice,
      newCabin.price,
    );
    const currency = booking.priceSnapshot?.currency || PLATFORM_CURRENCY;

    // Not isPositive(): decimal.js counts 0 as positive, and an equal fare
    // must not open a payment for 0.00.
    if (!difference.greaterThan(0)) {
      await this.applyNow(booking, index, next, newCabin, difference);
      if (difference.isZero()) {
        return {
          requiresPayment: false,
          applied: true,
          amountDifference: '0.00',
          currency,
        };
      }
      const refund = await this.refunds.issueFareDifference({
        bookingType: BookingType.FLIGHT,
        bookingId,
        amount: fixed(difference.abs()),
        reason: `Changed to flight ${next.flightNumber} at a lower fare`,
      });
      return {
        requiresPayment: false,
        applied: true,
        amountDifference: fixed(difference),
        currency,
        refunded: refund !== null && refund.status !== RefundStatus.FAILED,
        refundId: refund ? refund._id.toString() : null,
      };
    }

    return this.openPaidChange(
      user,
      booking,
      index,
      next,
      newCabin,
      difference,
      currency,
    );
  }

  /** FLT-27: apply a change whose fare difference Stripe says is paid. */
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
    const outcome = await this.settlePaid(booking, pending);
    if (outcome === 'refunded') {
      throw new ConflictException({
        code: 'CHANGE_NO_LONGER_POSSIBLE',
        message:
          'The booking or the new flight changed before the paid change could be applied, ' +
          'so the fare difference is refunded',
      });
    }
    return { applied: true, bookingId: String(booking._id) };
  }

  /**
   * Run by the hold-expiry job: settles every pending change whose seat hold
   * has ended. A paid one is applied (the user paid but never called apply),
   * one still being processed by Stripe waits for the next run, and an unpaid
   * one is cancelled at Stripe and its seats are released. Returns what
   * happened to each.
   */
  async settleExpiredChanges(now = new Date()): Promise<SettledChange[]> {
    const due = await this.bookingModel
      .find({
        'pendingChange.requestedAt': {
          $lte: new Date(now.getTime() - HOLD_MS),
        },
      })
      .sort({ 'pendingChange.requestedAt': 1 })
      .limit(EXPIRY_BATCH_SIZE)
      .exec();
    const outcomes: SettledChange[] = [];
    for (const booking of due) {
      try {
        outcomes.push(await this.settleExpired(booking));
      } catch (error) {
        this.logger.error(
          `Could not settle the flight change of booking ${String(booking._id)}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return outcomes;
  }

  private async settleExpired(
    booking: FlightBookingDocument,
  ): Promise<SettledChange> {
    const pending = booking.pendingChange;
    if (!pending) {
      return 'released';
    }
    let intent = await this.stripe.retrievePaymentIntent(
      pending.stripePaymentIntentId,
    );
    if (intent.status === 'processing') {
      return 'waiting';
    }
    if (intent.status !== 'succeeded' && intent.status !== 'canceled') {
      // Cancelling first means the user can no longer pay for a hold that is
      // about to go. If Stripe says it has already finished, it was paid in
      // the meantime: read it again and apply it.
      const cancelled = await this.stripe.cancelPaymentIntent(intent.id);
      if (!cancelled) {
        intent = await this.stripe.retrievePaymentIntent(intent.id);
      }
    }
    if (intent.status === 'succeeded') {
      return this.settlePaid(booking, pending);
    }
    await this.closePending(booking, pending);
    return 'released';
  }

  /**
   * The fare difference is paid. Applies the change if the booking and the
   * new flight still allow it; otherwise gives the difference back in full
   * and releases the seats it held. Either way the payment is recorded, so a
   * later refund can draw on it.
   */
  private async settlePaid(
    booking: FlightBookingDocument,
    pending: PendingFlightChange,
  ): Promise<'applied' | 'refunded'> {
    const index = pending.segmentIndex;
    const segment = booking.segments[index];
    const next = await this.usableFlight(pending.newFlightId.toString());
    const usable =
      booking.status === BookingStatus.CONFIRMED &&
      segment !== undefined &&
      next !== null &&
      this.keepsTripOrder(booking, index, next);

    if (!usable) {
      if (await this.closePending(booking, pending)) {
        await this.recordDifference(booking, pending);
        await this.refunds.issueFareDifference({
          bookingType: BookingType.FLIGHT,
          bookingId: String(booking._id),
          amount: pending.amountDifference,
          reason: 'A paid flight change could no longer be applied',
        });
      }
      return 'refunded';
    }

    const cabin = this.cabinOf(next, segment.cabinCategory);
    const update = this.changeUpdate(
      booking,
      index,
      next,
      cabin,
      pending.newCabinPrice,
      money(pending.amountDifference),
    );
    const newSeats = this.seatsOn(next._id, segment);
    await this.connection.transaction(async (session) => {
      const moved = await this.bookingModel
        .updateOne(
          {
            _id: booking._id,
            status: BookingStatus.CONFIRMED,
            'pendingChange.stripePaymentIntentId':
              pending.stripePaymentIntentId,
            [`segments.${index}.flightId`]: segment.flightId,
          },
          update,
          { session },
        )
        .exec();
      if (moved.modifiedCount !== 1) {
        throw changedMeanwhile();
      }
      if (!pending.seatsHeld) {
        // A change from before the seats were held at request time.
        await this.seats.hold(newSeats, session);
      }
      await this.seats.convertHeldToBooked(newSeats, session);
      await this.seats.releaseBooked(
        this.seatsOn(segment.flightId, segment),
        session,
      );
    });
    await this.recordDifference(booking, pending);
    return 'applied';
  }

  /** Same or lower fare: the change happens now, in one guarded transaction. */
  private async applyNow(
    booking: FlightBookingDocument,
    index: number,
    next: FlightDocument,
    cabin: Cabin,
    difference: Decimal,
  ): Promise<void> {
    const segment = booking.segments[index];
    const update = this.changeUpdate(
      booking,
      index,
      next,
      cabin,
      cabin.price,
      difference,
    );
    const newSeats = this.seatsOn(next._id, segment);
    await this.connection.transaction(async (session) => {
      const moved = await this.bookingModel
        .updateOne(
          {
            _id: booking._id,
            status: BookingStatus.CONFIRMED,
            pendingChange: null,
            [`segments.${index}.flightId`]: segment.flightId,
          },
          update,
          { session },
        )
        .exec();
      if (moved.modifiedCount !== 1) {
        throw changedMeanwhile();
      }
      await this.seats.hold(newSeats, session);
      await this.seats.convertHeldToBooked(newSeats, session);
      await this.seats.releaseBooked(
        this.seatsOn(segment.flightId, segment),
        session,
      );
    });
  }

  /**
   * Higher fare: a PaymentIntent for the difference, then, in one transaction,
   * the pending change and a seat hold on the new flight. If that transaction
   * fails (another change won, or the seats went), the PaymentIntent is
   * cancelled so nothing can be paid for it.
   */
  private async openPaidChange(
    user: AuthenticatedUser,
    booking: FlightBookingDocument,
    index: number,
    next: FlightDocument,
    cabin: Cabin,
    difference: Decimal,
    currency: string,
  ) {
    const segment = booking.segments[index];
    const requestedAt = new Date();
    const holdExpiresAt = new Date(requestedAt.getTime() + HOLD_MS);
    const intent = await this.stripe.createPaymentIntent({
      amount: fixed(difference),
      // A fresh key per request: a later request for the same flight, after an
      // earlier one expired, must not get the earlier (cancelled) intent back.
      idempotencyKey: `flt27:${String(booking._id)}:${new Types.ObjectId().toHexString()}`,
      bookingType: BookingType.FLIGHT,
      bookingId: String(booking._id),
      userId: user.userId,
    });
    try {
      await this.connection.transaction(async (session) => {
        const saved = await this.bookingModel
          .updateOne(
            {
              _id: booking._id,
              status: BookingStatus.CONFIRMED,
              pendingChange: null,
              [`segments.${index}.flightId`]: segment.flightId,
            },
            {
              $set: {
                pendingChange: {
                  newFlightId: next._id,
                  segmentIndex: index,
                  newCabinPrice: cabin.price,
                  amountDifference: fixed(difference),
                  currency,
                  stripePaymentIntentId: intent.id,
                  requestedAt,
                  holdExpiresAt,
                  seatsHeld: true,
                },
              },
            },
            { session },
          )
          .exec();
        if (saved.modifiedCount !== 1) {
          throw alreadyPending();
        }
        await this.seats.hold(this.seatsOn(next._id, segment), session);
      });
    } catch (error) {
      await this.cancelQuietly(intent.id);
      throw error;
    }
    return {
      requiresPayment: true,
      applied: false,
      amountDifference: fixed(difference),
      currency,
      clientSecret: intent.client_secret,
      stripePaymentIntentId: intent.id,
      holdExpiresAt: holdExpiresAt.toISOString(),
    };
  }

  /**
   * Ends a pending change without applying it, and gives back its seat hold,
   * in one transaction. Returns false when another caller ended it first.
   */
  private async closePending(
    booking: FlightBookingDocument,
    pending: PendingFlightChange,
  ): Promise<boolean> {
    const segment = booking.segments[pending.segmentIndex];
    let closed = false;
    await this.connection.transaction(async (session) => {
      const result = await this.bookingModel
        .updateOne(
          {
            _id: booking._id,
            'pendingChange.stripePaymentIntentId':
              pending.stripePaymentIntentId,
          },
          { $set: { pendingChange: null } },
          { session },
        )
        .exec();
      closed = result.modifiedCount === 1;
      if (closed && pending.seatsHeld && segment) {
        await this.seats.releaseHeld(
          this.seatsOn(pending.newFlightId, segment),
          session,
        );
      }
    });
    return closed;
  }

  /** The paid difference becomes a payment of the booking, for later refunds. */
  private async recordDifference(
    booking: FlightBookingDocument,
    pending: PendingFlightChange,
  ): Promise<void> {
    await this.payments.recordFareDifference({
      bookingType: BookingType.FLIGHT,
      bookingId: String(booking._id),
      userId: booking.userId.toString(),
      stripePaymentIntentId: pending.stripePaymentIntentId,
      amount: pending.amountDifference,
    });
  }

  /**
   * The booking update for moving one segment, worked out from the booking as
   * it was read. Nothing is changed in memory, so a transaction that Mongo
   * retries applies exactly the same update.
   */
  private changeUpdate(
    booking: FlightBookingDocument,
    index: number,
    next: FlightDocument,
    cabin: Cabin,
    price: Types.Decimal128,
    difference: Decimal,
  ) {
    const oldPrice = booking.segments[index].cabinPrice;
    const at = `segments.${index}`;
    const $set: Record<string, unknown> = {
      [`${at}.flightId`]: next._id,
      [`${at}.airlineId`]: next.airlineId,
      [`${at}.flightNumber`]: next.flightNumber,
      [`${at}.departureAirportId`]: next.departureAirportId,
      [`${at}.arrivalAirportId`]: next.arrivalAirportId,
      [`${at}.departureAtUtc`]: next.departureAtUtc,
      [`${at}.arrivalAtUtc`]: next.arrivalAtUtc,
      [`${at}.cabinPrice`]: price,
      [`${at}.freeBaggageCount`]: cabin.freeBaggageCount,
      [`${at}.maxBagWeightKg`]: cabin.maxBagWeightKg,
      // Seats chosen on the old flight (FLT-28) do not exist on the new one.
      [`${at}.seatAssignments`]: [],
      'priceSnapshot.subtotal': decimal128(
        money(booking.priceSnapshot.subtotal).plus(difference),
      ),
      'priceSnapshot.total': decimal128(
        money(booking.priceSnapshot.total).plus(difference),
      ),
      pendingChange: null,
    };
    booking.passengers.forEach((passenger, i) => {
      $set[`passengers.${i}.fareAmount`] = decimal128(
        money(passenger.fareAmount)
          .plus(fareFor(passenger.passengerType, price.toString()))
          .minus(fareFor(passenger.passengerType, oldPrice.toString())),
      );
    });
    return { $set };
  }

  private seatsOn(
    flightId: Types.ObjectId,
    segment: FlightBookingDocument['segments'][number],
  ): SeatChange {
    return {
      flightId,
      category: segment.cabinCategory,
      seats: segment.seatsRequired,
    };
  }

  private cabinOf(flight: FlightDocument, category: string): Cabin {
    const cabin = flight.cabinInventory.find((c) => c.category === category);
    if (!cabin) {
      throw new BadRequestException({
        code: 'CABIN_NOT_FOUND',
        message: 'The new flight has no such cabin',
      });
    }
    return cabin;
  }

  private async cancelQuietly(stripePaymentIntentId: string): Promise<void> {
    try {
      await this.stripe.cancelPaymentIntent(stripePaymentIntentId);
    } catch (error) {
      this.logger.warn(
        `Could not cancel PaymentIntent ${stripePaymentIntentId} of a refused flight change: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private async owned(user: AuthenticatedUser, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }
    const booking = await this.bookingModel
      .findOne({ _id: id, ...ownerFilter(user) })
      .exec();
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }
    return booking;
  }

  /** A flight that can be booked now, or null (FLT-30, ACC-15). */
  private async usableFlight(id: string): Promise<FlightDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const next = await this.flightModel.findById(id).exec();
    if (
      !next ||
      next.status !== FlightStatus.SCHEDULED ||
      next.departureAtUtc.getTime() <= Date.now()
    ) {
      return null;
    }
    const airline = await this.airlineModel
      .exists({ _id: next.airlineId, status: AirlineStatus.ACTIVE })
      .exec();
    return airline ? next : null;
  }

  private async bookableFlight(id: string): Promise<FlightDocument> {
    const next = await this.usableFlight(id);
    if (!next) {
      // A deactivated airline's flight cannot be booked either (ACC-15).
      throw new NotFoundException({
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight not found',
      });
    }
    return next;
  }

  private keepsTripOrder(
    booking: FlightBookingDocument,
    index: number,
    next: FlightDocument,
  ): boolean {
    const outbound = index === 0 ? next : booking.segments[0];
    const inbound = index === 1 ? next : booking.segments[1];
    return (
      !inbound ||
      outbound.arrivalAtUtc.getTime() < inbound.departureAtUtc.getTime()
    );
  }

  private assertKeepsTripOrder(
    booking: FlightBookingDocument,
    index: number,
    next: FlightDocument,
  ): void {
    if (!this.keepsTripOrder(booking, index, next)) {
      throw new BadRequestException({
        code: 'TRIP_ORDER_INVALID',
        message:
          'The outbound flight must arrive before the return flight departs',
      });
    }
  }

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
}
