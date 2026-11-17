import { ConflictException } from '@nestjs/common';

/**
 * GEN-11: the booking lifecycle shared by flight bookings and hotel
 * reservations. Flights (A1) and hotels (B2) keep their own collections, but
 * both use these states and these transitions, so a booking means the same
 * thing in every module.
 */
export enum BookingStatus {
  /** The 10-minute hold: inventory is reserved, payment has not succeeded. */
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  /** A verified Stripe payment succeeded (PAY-01). */
  CONFIRMED = 'CONFIRMED',
  /** The stay or the last flight segment is over. */
  COMPLETED = 'COMPLETED',
  /** The hold ran out before a payment succeeded; inventory was released. */
  EXPIRED = 'EXPIRED',
  /** Cancelled by the user or by the provider (FLT-26, FLT-06, HTL-21). */
  CANCELLED = 'CANCELLED',
}

export const BOOKING_STATUSES = Object.values(BookingStatus);

export enum BookingType {
  FLIGHT = 'FLIGHT',
  HOTEL = 'HOTEL',
}

export const BOOKING_TYPES = Object.values(BookingType);

/** Schema section 6: the provider a booking belongs to. */
export enum ProviderType {
  AIRLINE = 'AIRLINE',
  HOTEL = 'HOTEL',
}

/**
 * The only transitions GEN-11 allows. Anything missing from this table is a
 * bug, not a state a client may ask for: a status never comes from request
 * input.
 */
export const ALLOWED_BOOKING_TRANSITIONS: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = Object.freeze({
  [BookingStatus.PENDING_PAYMENT]: [
    BookingStatus.CONFIRMED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.CONFIRMED]: [
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
  ],
  // Terminal.
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.EXPIRED]: [],
  [BookingStatus.CANCELLED]: [],
});

export function isTransitionAllowed(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return ALLOWED_BOOKING_TRANSITIONS[from].includes(to);
}

/**
 * Throws 409 INVALID_BOOKING_STATE unless the transition is in the table.
 *
 * Staying in the same state is not allowed here on purpose: a caller that may
 * run twice (a retried webhook, the hold-expiry job racing a payment) should
 * notice that the work is already done and stop, rather than repeat the side
 * effects. isTransitionAllowed makes that check cheap.
 */
export function assertBookingTransition(
  from: BookingStatus,
  to: BookingStatus,
): void {
  if (!isTransitionAllowed(from, to)) {
    throw new ConflictException({
      code: 'INVALID_BOOKING_STATE',
      message: `A booking cannot go from ${from} to ${to}`,
    });
  }
}

/** True while the booking still holds inventory and awaits payment. */
export function isAwaitingPayment(status: BookingStatus): boolean {
  return status === BookingStatus.PENDING_PAYMENT;
}

/** True for a state that can never change again. */
export function isTerminal(status: BookingStatus): boolean {
  return ALLOWED_BOOKING_TRANSITIONS[status].length === 0;
}
