import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { BookingType } from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { decimal128ToString } from '../common/money/money';
import {
  NotificationResourceType,
  NotificationType,
} from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentStatus } from './payment-status.enum';
import { PaymentsService } from './payments.service';
import { RefundStatus } from './refund-status.enum';
import { RefundsService } from './refunds.service';
import { PaymentDocument } from './schemas/payment.schema';

export enum SettlementOutcome {
  /** The booking is confirmed by this payment (now, or on an earlier try). */
  CONFIRMED = 'CONFIRMED',
  /** The booking could not take the payment, so it is being refunded in full. */
  REFUNDED = 'REFUNDED',
}

/**
 * PAY-01: what happens once Stripe says the money is in.
 *
 * Two places learn that a PaymentIntent succeeded: the verified webhook, and
 * the expiry sweep when Stripe refuses to cancel an intent because it has
 * already been charged. Both hand the payment here, so a success is settled
 * the same way whichever arrives first, and settling it twice changes nothing.
 *
 * Settling does not depend on winning the move to SUCCEEDED. A status read
 * (GET /api/payments/:id) or the sweep may have written SUCCEEDED first, and a
 * webhook that then stopped because the status was "already set" left a paid
 * booking neither confirmed nor refunded. The booking module's confirmation is
 * idempotent instead, and `bookingConfirmedAt` makes sure the user is told once.
 *
 * A booking that cannot take the payment - the money arrived after the hold
 * ran out (FLT-22, HTL-18), the booking was confirmed by another payment, or
 * it is gone - is refunded in full and the user is told why. Retrying would
 * only get the same answer, so the event counts as handled.
 */
@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly bookings: BookingsGateway,
    private readonly refunds: RefundsService,
    private readonly notifications: NotificationsService,
  ) {}

  async settleSucceeded(payment: PaymentDocument): Promise<SettlementOutcome> {
    const current = await this.recordSucceeded(payment);
    if (current.bookingConfirmedAt) {
      return SettlementOutcome.CONFIRMED;
    }

    const bookingId = current.bookingId.toString();
    let confirmation: Awaited<
      ReturnType<BookingsGateway['confirmAfterPayment']>
    >;
    try {
      confirmation = await this.bookings.confirmAfterPayment(
        current.bookingType,
        bookingId,
        current._id.toString(),
      );
    } catch (error) {
      if (!isRefusal(error)) {
        // A database or network failure: not an answer about the booking.
        // Rethrown, so the webhook answers 5xx and Stripe tries again.
        throw error;
      }
      await this.refundLatePayment(current, bookingId, error);
      return SettlementOutcome.REFUNDED;
    }

    if (await this.payments.markBookingConfirmed(current._id)) {
      await this.notifications.notify({
        userId: current.userId,
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Booking confirmed',
        // The booking module may add what was booked (FLT-23: "with the booking
        // details"); the reference and the amount are always there.
        message:
          `Your ${label(current.bookingType)} ${confirmation.bookingReference} ` +
          `is confirmed${confirmation.summary ? `: ${confirmation.summary}` : ''}. ` +
          `${decimal128ToString(current.amount)} ${current.currency} was paid.`,
        resourceType: resourceTypeOf(current.bookingType),
        resourceId: bookingId,
      });
      this.logger.log(
        `Confirmed ${current.bookingType} booking ${bookingId} as ` +
          `${confirmation.bookingReference} after PaymentIntent ` +
          current.stripePaymentIntentId,
      );
    }
    return SettlementOutcome.CONFIRMED;
  }

  /**
   * A payment that succeeded for a booking that cannot be confirmed any more.
   * The payment stays SUCCEEDED, because Stripe did take the money; a full
   * refund of this payment is issued and the user is told why, once.
   */
  private async refundLatePayment(
    payment: PaymentDocument,
    bookingId: string,
    reason: HttpException,
  ): Promise<void> {
    const body = reason.getResponse() as { code?: unknown } | string;
    const code =
      typeof body === 'object' && typeof body.code === 'string'
        ? body.code
        : reason.getStatus() === HttpStatus.NOT_FOUND
          ? 'BOOKING_NOT_FOUND'
          : 'CONFLICT';
    this.logger.warn(
      `${payment.bookingType} booking ${bookingId} could not be confirmed ` +
        `after payment ${payment._id.toString()} (${code}): refunding in full`,
    );
    const { refund, created } = await this.refunds.refundUnconfirmablePayment(
      payment,
      `Payment succeeded after the booking could no longer be confirmed (${code})`,
    );
    if (!created) {
      // Settled before (the sweep and a late webhook can both get here): the
      // user has already been told.
      return;
    }
    await this.notifications.notify({
      userId: payment.userId,
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Booking not confirmed',
      message:
        `Your payment of ${decimal128ToString(payment.amount)} ${payment.currency} ` +
        whyNotConfirmed(code, label(payment.bookingType)) +
        (refund.status === RefundStatus.FAILED
          ? 'Please contact support for your refund.'
          : 'The full amount is being refunded.'),
      resourceType: resourceTypeOf(payment.bookingType),
      resourceId: bookingId,
    });
  }

  /**
   * Moves the payment to SUCCEEDED from whatever it was, including CANCELLED:
   * Stripe is the authority on whether money moved.
   */
  private async recordSucceeded(
    payment: PaymentDocument,
  ): Promise<PaymentDocument> {
    if (payment.status === PaymentStatus.SUCCEEDED) {
      return payment;
    }
    const moved = await this.payments.applyStatus(
      payment._id,
      payment.status,
      PaymentStatus.SUCCEEDED,
    );
    if (moved) {
      return moved;
    }
    // Someone else moved it in between; read what they left.
    return (await this.payments.findById(payment._id)) ?? payment;
  }
}

/**
 * The booking module's way of saying "this booking cannot take this payment":
 * 409 (hold expired, wrong state, confirmed by another payment) or 404 (the
 * booking is gone). Anything else is a failure to answer at all.
 */
function isRefusal(error: unknown): error is HttpException {
  return (
    error instanceof HttpException &&
    (error.getStatus() === HttpStatus.CONFLICT ||
      error.getStatus() === HttpStatus.NOT_FOUND)
  );
}

/** The reason in the user's words: only HOLD_EXPIRED is about the time running out. */
function whyNotConfirmed(code: string, what: string): string {
  if (code === 'HOLD_EXPIRED') {
    return `arrived after your ${what} hold had expired, so it could not be confirmed. `;
  }
  if (code === 'ALREADY_CONFIRMED_BY_ANOTHER_PAYMENT') {
    return `was not needed: your ${what} is already confirmed by another payment. `;
  }
  return `could not be applied: your ${what} can no longer be confirmed. `;
}

function resourceTypeOf(bookingType: BookingType): NotificationResourceType {
  return bookingType === BookingType.FLIGHT
    ? NotificationResourceType.FLIGHT_BOOKING
    : NotificationResourceType.HOTEL_BOOKING;
}

function label(bookingType: BookingType): string {
  return bookingType === BookingType.FLIGHT
    ? 'flight booking'
    : 'hotel reservation';
}
