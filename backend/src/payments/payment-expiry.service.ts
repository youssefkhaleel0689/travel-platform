import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingStatus } from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { HoldReleaseReason } from '../common/bookings/bookings.port';
import {
  PaymentSettlementService,
  SettlementOutcome,
} from './payment-settlement.service';
import { PaymentStatus } from './payment-status.enum';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

/** How many open payments one sweep looks at. */
const SWEEP_BATCH_SIZE = 100;

export interface SweepResult {
  checked: number;
  cancelled: number;
  /**
   * Intents Stripe would not cancel because they had already been paid. They
   * are settled like a webhook success - confirmed, or refunded in full when
   * the booking can no longer take them - and never recorded as cancelled.
   */
  settled: number;
}

/**
 * PAY-01: "when the hold expires the PaymentIntent is cancelled", and GEN-11:
 * PENDING_PAYMENT becomes EXPIRED.
 *
 * Why a sweep rather than a TTL index: two things have to happen together, and
 * MongoDB's TTL deletion can do neither. The PaymentIntent must be cancelled
 * at Stripe, so a confirmation cannot arrive after the inventory has gone
 * back, and the seats or rooms must be released by the module that owns them.
 *
 * Cancelling at Stripe is what makes a late payment unlikely. It cannot make
 * one impossible: a card can be charged in the moment between the hold ending
 * and this sweep reaching it, and then Stripe refuses the cancel. That payment
 * is settled instead (PaymentSettlementService), which refunds it in full when
 * the booking can no longer take it. The booking module releases the hold, and both steps are
 * safe to repeat, so a sweep that dies halfway simply finishes next time.
 */
@Injectable()
export class PaymentExpiryService {
  private readonly logger = new Logger(PaymentExpiryService.name);
  private running = false;

  constructor(
    private readonly payments: PaymentsService,
    private readonly stripe: StripeService,
    private readonly bookings: BookingsGateway,
    private readonly settlement: PaymentSettlementService,
  ) {}

  /**
   * Every minute: a 10-minute hold needs minute resolution at worst, and the
   * sweep only touches payments that are still open.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'expire-payment-holds' })
  async scheduledSweep(): Promise<void> {
    if (!this.stripe.isConfigured) {
      return;
    }
    // One run at a time: a slow Stripe call must not let two sweeps work on
    // the same payment.
    if (this.running) {
      this.logger.warn('Previous expiry sweep is still running; skipping');
      return;
    }
    this.running = true;
    try {
      const result = await this.sweep();
      if (result.cancelled > 0 || result.settled > 0) {
        this.logger.log(
          `Expiry sweep cancelled ${result.cancelled} and settled ` +
            `${result.settled} of ${result.checked} open payment(s)`,
        );
      }
    } catch (error) {
      // A failed sweep must never stop the schedule: the next run retries.
      this.logger.error(
        'Expiry sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Cancels the PaymentIntent and releases the hold for every open payment
   * whose booking is no longer payable. Public so it can be driven from a test
   * or by hand instead of waiting for the schedule.
   */
  async sweep(): Promise<SweepResult> {
    const open = await this.payments.findOpenPayments(SWEEP_BATCH_SIZE);
    let cancelled = 0;
    let settled = 0;

    for (const payment of open) {
      const bookingId = payment.bookingId.toString();
      try {
        const booking = await this.bookings.getPayableOrThrow(
          payment.bookingType,
          bookingId,
        );

        const expired =
          booking.holdExpiresAt !== null &&
          booking.holdExpiresAt.getTime() <= Date.now();
        const stillPayable =
          booking.status === BookingStatus.PENDING_PAYMENT && !expired;
        if (stillPayable) {
          continue;
        }
        // A booking that reached CONFIRMED has a succeeded payment of its own;
        // this open attempt is a stale one and is only cancelled at Stripe.
        const releaseInventory = booking.status === BookingStatus.PENDING_PAYMENT;

        const cancelledIntent = await this.stripe.cancelPaymentIntent(
          payment.stripePaymentIntentId,
        );
        if (cancelledIntent === null) {
          // Stripe would not cancel it because it had already finished. That
          // can mean it was paid at the last moment: the money is taken, so it
          // must be settled, not written off as cancelled with the seats gone.
          const intent = await this.stripe.retrievePaymentIntent(
            payment.stripePaymentIntentId,
          );
          if (intent.status === 'succeeded') {
            const outcome = await this.settlement.settleSucceeded(payment);
            if (outcome === SettlementOutcome.REFUNDED && releaseInventory) {
              // Refunded because the hold had run out: the seats or rooms
              // still go back, as they would for an unpaid hold.
              await this.bookings.releaseHold(
                payment.bookingType,
                bookingId,
                HoldReleaseReason.HOLD_EXPIRED,
              );
            }
            settled += 1;
            continue;
          }
        }
        const claimed = await this.payments.applyStatus(
          payment._id,
          payment.status,
          PaymentStatus.CANCELLED,
        );
        if (!claimed) {
          // A webhook got there first and has released the hold already.
          continue;
        }
        if (releaseInventory) {
          await this.bookings.releaseHold(
            payment.bookingType,
            bookingId,
            HoldReleaseReason.HOLD_EXPIRED,
          );
        }
        cancelled += 1;
      } catch (error) {
        // One bad payment must not stop the rest of the batch.
        this.logger.error(
          `Could not expire payment ${payment._id.toString()} for booking ${bookingId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return { checked: open.length, cancelled, settled };
  }
}
