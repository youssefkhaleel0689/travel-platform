import { randomInt } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import {
  assertBookingTransition,
  BookingStatus,
  BookingType,
  ProviderType,
} from '../../common/bookings/booking-status';
import type {
  BookingConfirmation,
  BookingPolicies,
  BookingsPort,
  HoldReleaseReason,
  PayableBooking,
} from '../../common/bookings/bookings.port';
import { FlightBooking, FlightSegment } from '../schemas/flight-booking.schema';
import {
  SeatChange,
  SeatInventoryService,
} from '../seat-inventory/seat-inventory.service';
import { moneyString, toPolicyDto } from './flight-booking.mapper';

// A booking reference like an airline PNR: 6 characters without 0/O and 1/I, which are
// easy to misread. 32^6 is about a billion; a clash is retried with a new reference.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERENCE_LENGTH = 6;
const REFERENCE_ATTEMPTS = 3;

// MongoDB error code of a violated unique index.
const DUPLICATE_KEY_ERROR = 11000;

export function newBookingReference(): string {
  let reference = '';
  for (let i = 0; i < REFERENCE_LENGTH; i++) {
    reference += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return reference;
}

function isDuplicateReference(error: unknown): boolean {
  const e = error as { code?: unknown; keyPattern?: Record<string, unknown> };
  return (
    e?.code === DUPLICATE_KEY_ERROR &&
    e.keyPattern !== undefined &&
    'bookingReference' in e.keyPattern
  );
}

// The seats one segment holds, as SeatInventoryService takes them.
function seatsOf(segment: FlightSegment): SeatChange {
  return {
    flightId: segment.flightId,
    category: segment.cabinCategory,
    seats: segment.seatsRequired,
  };
}

/**
 * The flights side of GEN-11's BookingsPort: how payments (C2) reads, confirms and
 * releases flight bookings without touching the flightBookings collection. Every status
 * change and its seat counters move together in one transaction, and every method is safe
 * to call twice, because a Stripe webhook and the expiry jobs can repeat themselves.
 */
@Injectable()
export class FlightBookingsPortAdapter implements BookingsPort {
  private readonly logger = new Logger(FlightBookingsPortAdapter.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly seatInventory: SeatInventoryService,
  ) {}

  /** PAY-01, PAY-02: the facts payments needs. Not filtered by user: payments checks. */
  async findPayable(bookingId: string): Promise<PayableBooking | null> {
    const booking = await this.find(bookingId);
    if (!booking) {
      return null;
    }
    return {
      bookingId,
      bookingType: BookingType.FLIGHT,
      userId: booking.userId.toString(),
      status: booking.status,
      totalAmount: moneyString(booking.priceSnapshot.total),
      currency: booking.priceSnapshot.currency,
      holdExpiresAt:
        booking.status === BookingStatus.PENDING_PAYMENT
          ? booking.holdExpiresAt
          : null,
      bookingReference: booking.bookingReference ?? null,
      providerType: ProviderType.AIRLINE,
      providerId: booking.policySnapshot.airlineId.toString(),
    };
  }

  /** PAY-02: the terms this booking carries (its snapshot), not the airline's latest. */
  async findPolicies(bookingId: string): Promise<BookingPolicies | null> {
    const booking = await this.find(bookingId);
    if (!booking) {
      return null;
    }
    const policy = toPolicyDto(booking.policySnapshot);
    return {
      bookingId,
      bookingType: BookingType.FLIGHT,
      providerType: ProviderType.AIRLINE,
      providerId: policy.airlineId,
      policyVersion: policy.version,
      policySnapshot: {
        airlineId: policy.airlineId,
        version: policy.version,
        extraBagPrice: policy.extraBagPrice,
        maxExtraBagsPerPassenger: policy.maxExtraBagsPerPassenger,
        cancellationTiers: policy.cancellationTiers,
      },
    };
  }

  /**
   * PAY-01, FLT-23: PENDING_PAYMENT -> CONFIRMED after a verified payment. The held seats
   * become booked seats and a unique booking reference is generated, in one transaction.
   * A repeated call returns the same reference; an expired hold is refused, because its
   * seats have gone back.
   */
  async confirmAfterPayment(
    bookingId: string,
    paymentId: string,
  ): Promise<BookingConfirmation> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.connection.transaction((session) =>
          this.confirm(bookingId, paymentId, session),
        );
      } catch (error) {
        // Two bookings drew the same reference: the unique index refused the second.
        if (attempt < REFERENCE_ATTEMPTS && isDuplicateReference(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * FLT-22: the hold expired or the payment failed. PENDING_PAYMENT -> EXPIRED and the
   * held seats go back, together. Only a PENDING_PAYMENT booking matches, so a second
   * call (the other expiry job, a repeated webhook) changes nothing.
   */
  async releaseHold(
    bookingId: string,
    reason: HoldReleaseReason,
  ): Promise<void> {
    const released = await this.connection.transaction(async (session) => {
      const booking = await this.bookingModel
        .findOneAndUpdate(
          { _id: bookingId, status: BookingStatus.PENDING_PAYMENT },
          { $set: { status: BookingStatus.EXPIRED, expiredAt: new Date() } },
          { session, returnDocument: 'after' },
        )
        .lean<FlightBooking>()
        .exec();
      if (!booking) {
        return false;
      }
      for (const segment of booking.segments) {
        await this.seatInventory.releaseHeld(seatsOf(segment), session);
      }
      return true;
    });
    if (released) {
      this.logger.log(
        `Released the hold of flight booking ${bookingId} (${reason})`,
      );
    }
  }

  /** ACC-12: a CONFIRMED booking with a flight that has not departed yet. */
  async hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    const found = await this.bookingModel
      .exists({
        userId,
        status: BookingStatus.CONFIRMED,
        'segments.departureAtUtc': { $gt: new Date() },
      })
      .exec();
    return found !== null;
  }

  private find(bookingId: string): Promise<FlightBooking | null> {
    return this.bookingModel.findById(bookingId).lean<FlightBooking>().exec();
  }

  private async confirm(
    bookingId: string,
    paymentId: string,
    session: ClientSession,
  ): Promise<BookingConfirmation> {
    const now = new Date();
    const booking = await this.bookingModel
      .findById(bookingId)
      .session(session)
      .lean<FlightBooking>()
      .exec();
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }
    // A webhook Stripe delivered again: the work is done, give the same answer.
    if (
      booking.status === BookingStatus.CONFIRMED &&
      booking.bookingReference
    ) {
      return {
        bookingId,
        status: BookingStatus.CONFIRMED,
        bookingReference: booking.bookingReference,
      };
    }
    // 409 INVALID_BOOKING_STATE for anything but PENDING_PAYMENT (GEN-11).
    assertBookingTransition(booking.status, BookingStatus.CONFIRMED);
    if (booking.holdExpiresAt.getTime() <= now.getTime()) {
      throw new ConflictException({
        code: 'HOLD_EXPIRED',
        message: 'The hold expired before the payment was confirmed',
      });
    }

    const bookingReference = newBookingReference();
    const result = await this.bookingModel
      .updateOne(
        { _id: booking._id, status: BookingStatus.PENDING_PAYMENT },
        {
          $set: {
            status: BookingStatus.CONFIRMED,
            confirmedAt: now,
            bookingReference,
            paymentId: new Types.ObjectId(paymentId),
          },
        },
        { session },
      )
      .exec();
    if (result.modifiedCount !== 1) {
      throw new ConflictException({
        code: 'INVALID_BOOKING_STATE',
        message: 'The booking changed while it was being confirmed',
      });
    }
    for (const segment of booking.segments) {
      await this.seatInventory.convertHeldToBooked(seatsOf(segment), session);
    }
    return { bookingId, status: BookingStatus.CONFIRMED, bookingReference };
  }
}
