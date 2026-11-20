import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { BookingType } from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { HoldReleaseReason } from '../common/bookings/bookings.port';
import { decimal128ToString } from '../common/money/money';
import {
  NotificationResourceType,
  NotificationType,
} from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentStatus } from './payment-status.enum';
import { PaymentsService } from './payments.service';
import { CancelledBy } from './refund-status.enum';
import { RefundsService } from './refunds.service';
import { PaymentDocument } from './schemas/payment.schema';
import {
  StripeWebhookEvent,
  WebhookEventStatus,
} from './schemas/stripe-webhook-event.schema';
import { StripeService } from './stripe.service';

/** Returned to the controller so Stripe always gets a 2xx with a reason. */
export interface WebhookOutcome {
  received: true;
  status: WebhookEventStatus;
  eventId: string;
}

const HANDLED_EVENT_TYPES = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  // PAY-03: a refund Stripe settles later (PENDING -> REFUNDED or FAILED).
  'refund.updated',
  'refund.failed',
  'charge.refund.updated',
];

const REFUND_EVENT_TYPES = [
  'refund.updated',
  'refund.failed',
  'charge.refund.updated',
];

/**
 * PAY-01: the only place a booking becomes CONFIRMED.
 *
 * Why not when the browser says it paid: the browser can lie, can be closed
 * before it reports, and cannot be trusted about money. Stripe signs its
 * events, so a verified webhook is the only statement about a payment this
 * backend acts on (GEN-13).
 *
 * Exactly once, not at least once: Stripe retries until it gets a 2xx and may
 * deliver the same event twice anyway. Inserting a row keyed by the Stripe
 * event id is how a delivery claims the event; the unique index makes the
 * second delivery a no-op, so a booking is never confirmed twice and
 * inventory is never released twice.
 */
@Injectable()
export class PaymentsWebhookService {
  private readonly logger = new Logger(PaymentsWebhookService.name);

  constructor(
    @InjectModel(StripeWebhookEvent.name)
    private readonly eventModel: Model<StripeWebhookEvent>,
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
    private readonly bookings: BookingsGateway,
    private readonly notifications: NotificationsService,
    private readonly refunds: RefundsService,
  ) {}

  /**
   * Verifies the signature, claims the event, handles it.
   *
   * A failure is recorded and rethrown, so Stripe retries it; anything that
   * has already been handled answers without doing the work again.
   */
  async handle(rawBody: Buffer, signature: string): Promise<WebhookOutcome> {
    const event = this.stripe.constructWebhookEvent(rawBody, signature);

    const claimed = await this.claim(event);
    if (!claimed) {
      // Already seen. Answering 2xx stops Stripe retrying.
      this.logger.log(`Ignoring repeat delivery of ${event.id}`);
      return {
        received: true,
        status: WebhookEventStatus.PROCESSED,
        eventId: event.id,
      };
    }

    if (!HANDLED_EVENT_TYPES.includes(event.type)) {
      await this.finish(event.id, WebhookEventStatus.IGNORED);
      return {
        received: true,
        status: WebhookEventStatus.IGNORED,
        eventId: event.id,
      };
    }

    try {
      await this.dispatch(event);
      await this.finish(event.id, WebhookEventStatus.PROCESSED);
      return {
        received: true,
        status: WebhookEventStatus.PROCESSED,
        eventId: event.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.finish(event.id, WebhookEventStatus.FAILED, message);
      this.logger.error(
        `Handling ${event.type} ${event.id} failed`,
        error instanceof Error ? error.stack : message,
      );
      // Rethrown on purpose: a 5xx makes Stripe retry, and the row is FAILED
      // rather than PROCESSED, so the retry is allowed to claim it again.
      throw error;
    }
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    if (REFUND_EVENT_TYPES.includes(event.type)) {
      await this.refunds.syncFromStripe(event.data.object as Stripe.Refund);
      return;
    }
    const intent = event.data.object as Stripe.PaymentIntent;
    const payment = await this.payments.findByStripeId(intent.id);
    if (!payment) {
      // A PaymentIntent this platform never created, or one from another
      // environment pointed at the same webhook endpoint. Nothing to do.
      this.logger.warn(`No payment for PaymentIntent ${intent.id}`);
      return;
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onSucceeded(payment, intent);
        return;
      case 'payment_intent.payment_failed':
        await this.onFailed(payment, intent);
        return;
      case 'payment_intent.canceled':
        await this.onCancelled(payment);
        return;
      default:
        return;
    }
  }

  /**
   * The money is in. Confirm the booking, then tell the user (GEN-01).
   *
   * applyStatus moves the payment from its previous status in one conditional
   * update, so only one delivery of the event gets past it and the booking is
   * confirmed once. Confirmation itself is also idempotent on the booking
   * module's side, which covers a retry that crashes between the two steps.
   */
  private async onSucceeded(
    payment: PaymentDocument,
    intent: Stripe.PaymentIntent,
  ): Promise<void> {
    const claimed = await this.payments.applyStatus(
      payment._id,
      payment.status,
      PaymentStatus.SUCCEEDED,
    );
    if (!claimed) {
      this.logger.log(
        `Payment ${payment._id.toString()} was already recorded as ` +
          `${payment.status}; not confirming again`,
      );
      return;
    }

    const bookingId = payment.bookingId.toString();
    let confirmation: Awaited<ReturnType<BookingsGateway['confirmAfterPayment']>>;
    try {
      confirmation = await this.bookings.confirmAfterPayment(
        payment.bookingType,
        bookingId,
        payment._id.toString(),
      );
    } catch (error) {
      // FLT-22, HTL-18: the money arrived but the booking can no longer be
      // confirmed (its hold ran out and the seats or rooms went back). The
      // customer must not stay charged for nothing: refund it all.
      if (isConflict(error)) {
        await this.refundLatePayment(payment, bookingId, error);
        return;
      }
      throw error;
    }

    await this.notifications.notify({
      userId: payment.userId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Booking confirmed',
      // The booking module may add what was booked (FLT-23: "with the booking
      // details"); the reference and the amount are always there.
      message:
        `Your ${label(payment.bookingType)} ${confirmation.bookingReference} ` +
        `is confirmed${confirmation.summary ? `: ${confirmation.summary}` : ''}. ` +
        `${decimal128ToString(payment.amount)} ${payment.currency} was paid.`,
      resourceType:
        payment.bookingType === BookingType.FLIGHT
          ? NotificationResourceType.FLIGHT_BOOKING
          : NotificationResourceType.HOTEL_BOOKING,
      resourceId: bookingId,
    });

    this.logger.log(
      `Confirmed ${payment.bookingType} booking ${bookingId} as ` +
        `${confirmation.bookingReference} after PaymentIntent ${intent.id}`,
    );
  }

  /**
   * A payment that succeeded for a booking that cannot be confirmed any more
   * (usually: the webhook arrived after the 10-minute hold). The payment stays
   * SUCCEEDED, because Stripe did take the money; a full refund is issued and
   * the user is told why. The event is then handled, so Stripe stops retrying.
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
        : 'CONFLICT';
    this.logger.warn(
      `${payment.bookingType} booking ${bookingId} could not be confirmed ` +
        `after payment ${payment._id.toString()} (${code}): refunding in full`,
    );
    const refund = await this.refunds.issueForCancellation({
      bookingType: payment.bookingType,
      bookingId,
      cancelledBy: CancelledBy.SYSTEM,
      refundPercentage: 100,
      reason: `Payment succeeded after the booking could no longer be confirmed (${code})`,
    });
    await this.notifications.notify({
      userId: payment.userId,
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Booking not confirmed',
      message:
        `Your payment of ${decimal128ToString(payment.amount)} ${payment.currency} ` +
        `arrived after your ${label(payment.bookingType)} hold had expired, so it ` +
        `could not be confirmed. ` +
        (refund
          ? 'The full amount is being refunded.'
          : 'Please contact support for your refund.'),
      resourceType:
        payment.bookingType === BookingType.FLIGHT
          ? NotificationResourceType.FLIGHT_BOOKING
          : NotificationResourceType.HOTEL_BOOKING,
      resourceId: bookingId,
    });
  }

  /**
   * The attempt failed. The hold is deliberately left alone: PAY-01 lets the
   * user retry until it expires, so releasing the seats now would take away
   * the thing they are still trying to pay for. The expiry sweep releases it
   * if they never succeed.
   */
  private async onFailed(
    payment: PaymentDocument,
    intent: Stripe.PaymentIntent,
  ): Promise<void> {
    await this.payments.applyStatus(
      payment._id,
      payment.status,
      PaymentStatus.FAILED,
      { failureMessage: intent.last_payment_error?.message ?? null },
    );
  }

  /**
   * Stripe cancelled the PaymentIntent, which for this platform means the hold
   * ran out. The seats or rooms go back, once: releaseHold is required to be
   * idempotent, and the conditional status update keeps a repeat delivery from
   * calling it a second time.
   */
  private async onCancelled(payment: PaymentDocument): Promise<void> {
    const claimed = await this.payments.applyStatus(
      payment._id,
      payment.status,
      PaymentStatus.CANCELLED,
    );
    if (!claimed) {
      return;
    }
    await this.bookings.releaseHold(
      payment.bookingType,
      payment.bookingId.toString(),
      HoldReleaseReason.PAYMENT_FAILED,
    );
  }

  /**
   * Inserts the event row. Returns false when the unique index rejects it,
   * which means another delivery of the same event already has it.
   */
  private async claim(event: Stripe.Event): Promise<boolean> {
    const intent = event.data.object as Partial<Stripe.PaymentIntent>;
    const bookingId = intent.metadata?.bookingId;

    try {
      await this.eventModel.create({
        stripeEventId: event.id,
        type: event.type,
        bookingId:
          bookingId && Types.ObjectId.isValid(bookingId)
            ? new Types.ObjectId(bookingId)
            : null,
        status: WebhookEventStatus.PROCESSING,
        receivedAt: new Date(),
        processedAt: null,
        error: null,
      });
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) {
        // A delivery that failed earlier is allowed to be tried again; one
        // that is finished or in flight is not.
        const retaken = await this.eventModel
          .findOneAndUpdate(
            { stripeEventId: event.id, status: WebhookEventStatus.FAILED },
            {
              $set: {
                status: WebhookEventStatus.PROCESSING,
                receivedAt: new Date(),
                error: null,
              },
            },
            { returnDocument: 'after' },
          )
          .exec();
        return retaken !== null;
      }
      throw error;
    }
  }

  private async finish(
    stripeEventId: string,
    status: WebhookEventStatus,
    error: string | null = null,
  ): Promise<void> {
    await this.eventModel
      .updateOne(
        { stripeEventId },
        { $set: { status, processedAt: new Date(), error } },
      )
      .exec();
  }
}

function label(bookingType: BookingType): string {
  return bookingType === BookingType.FLIGHT
    ? 'flight booking'
    : 'hotel reservation';
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

/** A 409 from the booking module: the booking is in no state to confirm. */
function isConflict(error: unknown): error is HttpException {
  return (
    error instanceof HttpException && error.getStatus() === HttpStatus.CONFLICT
  );
}
