import { randomInt } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Connection, Model, QueryFilter } from 'mongoose';
import {
  assertBookingTransition,
  BookingStatus,
  BookingType,
  ProviderType,
} from '../../common/bookings/booking-status';
import type {
  AdminBookingFilter,
  AdminBookingList,
  BookingConfirmation,
  BookingPolicies,
  BookingsPort,
  HoldReleaseReason,
  PayableBooking,
} from '../../common/bookings/bookings.port';
import { Airline } from '../schemas/airline.schema';
import { FlightBooking, FlightSegment } from '../schemas/flight-booking.schema';
import {
  SeatChange,
  SeatInventoryService,
} from '../seat-inventory/seat-inventory.service';
import {
  decimal128ToString,
  PLATFORM_CURRENCY,
} from '../../common/money/money';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { toAirportLocalIso } from '../../common/time/airport-time';
import { formatLocalTime } from './e-ticket/e-ticket.view';
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

// What ACC-17's filters mean against the flightBookings collection. createdAt
// comes from `timestamps: true`; the range is half-open so a day boundary
// belongs to exactly one range.
function adminFilterToQuery(
  filter: AdminBookingFilter,
): QueryFilter<FlightBooking> {
  const query: QueryFilter<FlightBooking> = {};
  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.reference) {
    query.bookingReference = filter.reference;
  }
  if (filter.createdFrom || filter.createdTo) {
    query.createdAt = {
      ...(filter.createdFrom ? { $gte: filter.createdFrom } : {}),
      ...(filter.createdTo ? { $lt: filter.createdTo } : {}),
    };
  }
  return query;
}

// What .lean() gives back for a booking document.
type LeanFlightBooking = FlightBooking & { _id: Types.ObjectId };

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
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
    @InjectConnection() private readonly connection: Connection,
    private readonly seatInventory: SeatInventoryService,
    private readonly referenceData: ReferenceDataService,
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
        const { confirmation, booking } = await this.connection.transaction(
          (session) => this.confirm(bookingId, paymentId, session),
        );
        // After the commit, and never fatal: the booking is paid and confirmed
        // whatever happens here, so a failed airport lookup only shortens the
        // notice to the reference and the amount.
        const summary = await this.summary(booking).catch((error: unknown) => {
          this.logger.warn(
            `No summary for flight booking ${bookingId}: ${String(error)}`,
          );
          return undefined;
        });
        return { ...confirmation, summary };
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

  /**
   * ACC-17: the newest flight bookings an admin may see, with the airline name
   * the list shows. Read-only, and not filtered by user: an admin sees every
   * account's bookings.
   *
   * The count and the rows run in parallel, as paginateQuery does, and the
   * airline names are fetched in one query for the whole page rather than one
   * per row.
   */
  async listForAdmin(filter: AdminBookingFilter): Promise<AdminBookingList> {
    const query = adminFilterToQuery(filter);
    const [bookings, total] = await Promise.all([
      this.bookingModel
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(filter.limit)
        .lean<LeanFlightBooking[]>()
        .exec(),
      this.bookingModel.countDocuments(query).exec(),
    ]);

    // A read-only admin list must not fail on one incomplete row. A booking
    // written straight to the collection (a test fixture, an old document) can
    // lack the policy or price snapshot, so each field falls back instead of
    // throwing: the airline from the first segment, the trip dates from when
    // the booking was made, the amount as 0.00.
    const airlineOf = (booking: LeanFlightBooking) =>
      booking.policySnapshot?.airlineId ?? booking.segments?.[0]?.airlineId;
    const airlineNames = await this.airlineNames(
      bookings
        .map(airlineOf)
        .filter((id): id is Types.ObjectId => id !== undefined && id !== null),
    );

    return {
      rows: bookings.map((booking) => {
        const segments = booking.segments ?? [];
        const departures = segments.map((segment) =>
          segment.departureAtUtc.getTime(),
        );
        const arrivals = segments.map((segment) =>
          segment.arrivalAtUtc.getTime(),
        );
        // A bare row may even lack createdAt; the id still carries the time
        // it was made, and the admin list sorts and shows by it.
        const madeAtDate = booking.createdAt ?? booking._id.getTimestamp();
        const madeAt = madeAtDate.getTime();
        const airlineId = airlineOf(booking)?.toString() ?? '';
        return {
          bookingId: booking._id.toString(),
          bookingType: BookingType.FLIGHT,
          bookingReference: booking.bookingReference ?? null,
          userId: booking.userId.toString(),
          providerType: ProviderType.AIRLINE,
          providerId: airlineId,
          providerName: airlineNames.get(airlineId) ?? null,
          // A round trip has two segments: the trip runs from the first
          // departure to the last arrival.
          startsAt: new Date(
            departures.length ? Math.min(...departures) : madeAt,
          ),
          endsAt: new Date(arrivals.length ? Math.max(...arrivals) : madeAt),
          totalAmount:
            decimal128ToString(booking.priceSnapshot?.total) ?? '0.00',
          currency: booking.priceSnapshot?.currency ?? PLATFORM_CURRENCY,
          status: booking.status,
          createdAt: madeAtDate,
        };
      }),
      total,
    };
  }

  /** Airline names for one page of bookings, in a single query. */
  private async airlineNames(
    ids: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const unique = [...new Map(ids.map((id) => [id.toString(), id])).values()];
    if (unique.length === 0) {
      return new Map();
    }
    const airlines = await this.airlineModel
      .find({ _id: { $in: unique } })
      .select('name')
      .lean<{ _id: Types.ObjectId; name: string }[]>()
      .exec();
    return new Map(
      airlines.map((airline) => [airline._id.toString(), airline.name]),
    );
  }

  /**
   * FLT-23: what the confirmation notice names, e.g. "KD100 CAI to DXB on 20 Dec
   * 2026, 08:30 and KD101 DXB to CAI on 27 Dec 2026, 16:00; 3 passengers". Times
   * are local to each departure airport (GEN-06).
   */
  private async summary(booking: FlightBooking): Promise<string> {
    const flights: string[] = [];
    for (const segment of booking.segments) {
      const { timeZone } = await this.referenceData.getAirportOrThrow(
        segment.departureAirportId,
      );
      const departure = formatLocalTime(
        toAirportLocalIso(segment.departureAtUtc, timeZone),
        false,
      );
      flights.push(
        `${segment.flightNumber} ${segment.departureAirportId} to ` +
          `${segment.arrivalAirportId} on ${departure}`,
      );
    }
    const count = booking.passengers.length;
    return `${flights.join(' and ')}; ${count} passenger${count === 1 ? '' : 's'}`;
  }

  private find(bookingId: string): Promise<FlightBooking | null> {
    return this.bookingModel.findById(bookingId).lean<FlightBooking>().exec();
  }

  // The confirmation, and the booking it was made from, for the summary.
  private async confirm(
    bookingId: string,
    paymentId: string,
    session: ClientSession,
  ): Promise<{ confirmation: BookingConfirmation; booking: FlightBooking }> {
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
    // Only for the payment that confirmed it, though. Another payment for a
    // booking that is already confirmed (a double payment) gets 409, so the
    // payments module refunds it instead of telling the user "confirmed"
    // twice and keeping both charges. A booking confirmed before paymentId was
    // stored has none and keeps the old answer.
    if (
      booking.status === BookingStatus.CONFIRMED &&
      booking.bookingReference
    ) {
      if (booking.paymentId && booking.paymentId.toString() !== paymentId) {
        throw new ConflictException({
          code: 'ALREADY_CONFIRMED_BY_ANOTHER_PAYMENT',
          message: 'This booking is already confirmed by another payment',
        });
      }
      return {
        confirmation: {
          bookingId,
          status: BookingStatus.CONFIRMED,
          bookingReference: booking.bookingReference,
        },
        booking,
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
    return {
      confirmation: {
        bookingId,
        status: BookingStatus.CONFIRMED,
        bookingReference,
      },
      booking,
    };
  }
}
