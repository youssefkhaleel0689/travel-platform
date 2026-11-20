import {
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  FLIGHT_BOOKINGS_PORT,
  HoldReleaseReason,
  HOTEL_BOOKINGS_PORT,
} from './bookings.port';
// Types only: a type in a decorated constructor signature has to be imported
// this way while isolatedModules and emitDecoratorMetadata are both on.
import type {
  AdminBookingFilter,
  AdminBookingRow,
  BookingConfirmation,
  BookingsPort,
  BookingPolicies,
  PayableBooking,
} from './bookings.port';
import { BookingType } from './booking-status';
import { PageDto, PageMetaDto } from '../pagination/dto/page.dto';
import { PAGE_SIZE } from '../pagination/pagination.constants';

/** ACC-17: the filters an admin may apply, before a port is chosen. */
export type AdminBookingsQuery = Omit<AdminBookingFilter, 'limit'> & {
  /** Only this module's bookings; both modules when it is left out. */
  bookingType?: BookingType;
};

/**
 * A port that is wired in and implements the optional ACC-17 listing. Written
 * as a type guard so the call below needs no non-null assertion.
 */
function listsForAdmin(
  port: BookingsPort | undefined,
): port is BookingsPort & Required<Pick<BookingsPort, 'listForAdmin'>> {
  return typeof port?.listForAdmin === 'function';
}

/**
 * Newest booking first, with the id as a tie-break so two bookings made in the
 * same millisecond - in one collection or in both - always come back in the
 * same order and never repeat or vanish between pages.
 */
function newestFirst(a: AdminBookingRow, b: AdminBookingRow): number {
  const byDate = b.createdAt.getTime() - a.createdAt.getTime();
  return byDate !== 0 ? byDate : b.bookingId.localeCompare(a.bookingId);
}

/**
 * Routes a booking type to the module that owns it.
 *
 * Both ports are optional, so the application runs with neither, one or both
 * of them wired. While a booking module is still being built, its routes
 * answer 501 NOT_IMPLEMENTED with a clear message instead of the app refusing
 * to start or, worse, a 500 that looks like a bug in payments.
 */
@Injectable()
export class BookingsGateway {
  constructor(
    @Optional()
    @Inject(FLIGHT_BOOKINGS_PORT)
    private readonly flightPort?: BookingsPort,
    @Optional()
    @Inject(HOTEL_BOOKINGS_PORT)
    private readonly hotelPort?: BookingsPort,
  ) {}

  /** True when the module that owns this booking type is wired in. */
  supports(bookingType: BookingType): boolean {
    return this.port(bookingType) !== undefined;
  }

  /**
   * The booking, or 404 when there is none. A malformed id is a 404 too, so an
   * id cannot be probed for its format.
   */
  async getPayableOrThrow(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PayableBooking> {
    if (!Types.ObjectId.isValid(bookingId)) {
      throw new NotFoundException('Booking not found');
    }
    const booking = await this.portOrThrow(bookingType).findPayable(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  async getPoliciesOrThrow(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<BookingPolicies> {
    if (!Types.ObjectId.isValid(bookingId)) {
      throw new NotFoundException('Booking not found');
    }
    const policies =
      await this.portOrThrow(bookingType).findPolicies(bookingId);
    if (!policies) {
      throw new NotFoundException('Booking not found');
    }
    return policies;
  }

  confirmAfterPayment(
    bookingType: BookingType,
    bookingId: string,
    paymentId: string,
  ): Promise<BookingConfirmation> {
    return this.portOrThrow(bookingType).confirmAfterPayment(
      bookingId,
      paymentId,
    );
  }

  releaseHold(
    bookingType: BookingType,
    bookingId: string,
    reason: HoldReleaseReason,
  ): Promise<void> {
    return this.portOrThrow(bookingType).releaseHold(bookingId, reason);
  }

  /**
   * ACC-12: true when any wired booking module reports an upcoming CONFIRMED
   * booking for this account.
   *
   * A booking type that is not wired in yet cannot report one, so it is
   * skipped rather than throwing: deactivation must not be impossible just
   * because a module is still being built. Both modules are asked in parallel.
   */
  async hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    const ports = [this.flightPort, this.hotelPort].filter(
      (port): port is BookingsPort => port !== undefined,
    );
    const answers = await Promise.all(
      ports.map((port) => port.hasUpcomingConfirmedBookings(userId)),
    );
    return answers.some(Boolean);
  }

  /**
   * ACC-17: one page of every booking an admin may see, newest first.
   *
   * Flights and hotels keep their own collections, so each wired module is
   * asked for its newest `page x 10` rows and the two lists are merged here.
   * The page the admin asked for is always inside that merge: a row on page n
   * cannot be older than the nth newest row of either module.
   *
   * A module that is not wired in, or one whose port does not implement
   * listForAdmin yet, has no bookings to report here, so it is skipped rather
   * than answering 501 - an admin list must not break because a module is
   * still being built. Asking for a type whose module is missing or silent
   * therefore gives an empty page rather than an error.
   */
  async listForAdmin(
    query: AdminBookingsQuery,
    page: number,
  ): Promise<PageDto<AdminBookingRow>> {
    const { bookingType, ...filter } = query;
    const ports = (
      bookingType === undefined
        ? [this.flightPort, this.hotelPort]
        : [this.port(bookingType)]
    ).filter(listsForAdmin);

    const limit = page * PAGE_SIZE;
    const answers = await Promise.all(
      ports.map((port) => port.listForAdmin({ ...filter, limit })),
    );

    const rows = answers
      .flatMap((answer) => answer.rows)
      .sort(newestFirst)
      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const totalItems = answers.reduce((sum, answer) => sum + answer.total, 0);

    return new PageDto(rows, PageMetaDto.create(page, totalItems));
  }

  /**
   * BON-01: every matching booking in one list, for aggregation. The admin
   * analytics endpoint asks for a date range, not a page, so it needs the full
   * result rather than one page of ten.
   */
  async listAllForAdmin(query: AdminBookingsQuery): Promise<AdminBookingRow[]> {
    const { bookingType, ...filter } = query;
    const ports = (
      bookingType === undefined
        ? [this.flightPort, this.hotelPort]
        : [this.port(bookingType)]
    ).filter(listsForAdmin);

    const answers = await Promise.all(
      ports.map((port) => port.listForAdmin({ ...filter, limit: 100000 })),
    );
    return answers.flatMap((answer) => answer.rows).sort(newestFirst);
  }

  private port(bookingType: BookingType): BookingsPort | undefined {
    return bookingType === BookingType.FLIGHT
      ? this.flightPort
      : this.hotelPort;
  }

  private portOrThrow(bookingType: BookingType): BookingsPort {
    const port = this.port(bookingType);
    if (!port) {
      throw new NotImplementedException({
        code: 'BOOKING_TYPE_UNAVAILABLE',
        message:
          `${bookingType} bookings are not available yet: the module that ` +
          'owns them has not been connected to payments',
      });
    }
    return port;
  }
}
