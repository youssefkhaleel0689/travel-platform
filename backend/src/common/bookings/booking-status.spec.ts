import { ConflictException } from '@nestjs/common';
import {
  ALLOWED_BOOKING_TRANSITIONS,
  assertBookingTransition,
  BOOKING_STATUSES,
  BookingStatus,
  isAwaitingPayment,
  isTerminal,
  isTransitionAllowed,
} from './booking-status';

describe('booking lifecycle (GEN-11)', () => {
  it('has exactly the five states of the requirement', () => {
    expect(BOOKING_STATUSES).toEqual([
      'PENDING_PAYMENT',
      'CONFIRMED',
      'COMPLETED',
      'EXPIRED',
      'CANCELLED',
    ]);
  });

  // GEN-11 names four transitions and no others.
  it.each([
    [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
    [BookingStatus.PENDING_PAYMENT, BookingStatus.EXPIRED],
    [BookingStatus.CONFIRMED, BookingStatus.COMPLETED],
    [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  ])('allows %s -> %s', (from, to) => {
    expect(isTransitionAllowed(from, to)).toBe(true);
    expect(() => assertBookingTransition(from, to)).not.toThrow();
  });

  it('allows nothing else', () => {
    const allowed = new Set([
      'PENDING_PAYMENT->CONFIRMED',
      'PENDING_PAYMENT->EXPIRED',
      'CONFIRMED->COMPLETED',
      'CONFIRMED->CANCELLED',
    ]);

    for (const from of BOOKING_STATUSES) {
      for (const to of BOOKING_STATUSES) {
        expect(isTransitionAllowed(from, to)).toBe(
          allowed.has(`${from}->${to}`),
        );
      }
    }
  });

  // Each of these is a bug someone will try to write at some point.
  it.each([
    // A late payment must not confirm an expired hold.
    [BookingStatus.EXPIRED, BookingStatus.CONFIRMED],
    // A cancellation is final; it is not re-confirmed.
    [BookingStatus.CANCELLED, BookingStatus.CONFIRMED],
    // A finished stay is not cancelled afterwards.
    [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
    // Payment does not skip confirmation.
    [BookingStatus.PENDING_PAYMENT, BookingStatus.COMPLETED],
    // An unpaid hold is expired, never cancelled.
    [BookingStatus.PENDING_PAYMENT, BookingStatus.CANCELLED],
  ])('refuses %s -> %s with 409', (from, to) => {
    expect(() => assertBookingTransition(from, to)).toThrow(ConflictException);
    expect(() => assertBookingTransition(from, to)).toThrow(
      new RegExp(`${from} to ${to}`),
    );
  });

  // A caller that may run twice (a retried webhook, the expiry job racing a
  // payment) has to notice the work is done rather than repeat it.
  it.each(BOOKING_STATUSES)('refuses %s -> itself', (status) => {
    expect(isTransitionAllowed(status, status)).toBe(false);
  });

  it('knows which states are terminal', () => {
    expect(isTerminal(BookingStatus.COMPLETED)).toBe(true);
    expect(isTerminal(BookingStatus.EXPIRED)).toBe(true);
    expect(isTerminal(BookingStatus.CANCELLED)).toBe(true);
    expect(isTerminal(BookingStatus.PENDING_PAYMENT)).toBe(false);
    expect(isTerminal(BookingStatus.CONFIRMED)).toBe(false);
  });

  it('knows which state holds inventory', () => {
    expect(isAwaitingPayment(BookingStatus.PENDING_PAYMENT)).toBe(true);
    expect(isAwaitingPayment(BookingStatus.CONFIRMED)).toBe(false);
  });

  it('cannot be edited at runtime', () => {
    expect(Object.isFrozen(ALLOWED_BOOKING_TRANSITIONS)).toBe(true);
  });
});
