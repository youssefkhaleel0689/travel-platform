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
  BookingConfirmation,
  BookingsPort,
  BookingPolicies,
  PayableBooking,
} from './bookings.port';
import { BookingType } from './booking-status';

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
