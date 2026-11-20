import type Stripe from 'stripe';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingType } from '../common/bookings/booking-status';
import {
  addMoney,
  decimal128ToString,
  isGreaterThan,
  isZero,
  percentageOf,
  PLATFORM_CURRENCY,
  toDecimal128,
} from '../common/money/money';
import {
  NotificationResourceType,
  NotificationType,
} from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from './payments.service';
import {
  CancelledBy,
  fromStripeRefundStatus,
  RefundStatus,
} from './refund-status.enum';
import { Refund, RefundDocument } from './schemas/refund.schema';
import { StripeService } from './stripe.service';

export interface IssueRefundInput {
  bookingType: BookingType;
  bookingId: string;
  /** USER applies the provider's tier; PROVIDER is always a full refund. */
  cancelledBy: CancelledBy;
  /**
   * The tier the provider's policy gives for this cancellation, 0 to 100.
   * Ignored for a provider cancellation, which is always 100 (PAY-03).
   */
  refundPercentage: number;
  reason: string;
  /** The cancellation terms the percentage came from, for the record. */
  policySnapshot?: Record<string, unknown> | null;
}

/**
 * PAY-03: refunds.
 *
 * The flights and hotels modules call this when they cancel a booking
 * (FLT-06, FLT-26, HTL-21). They work out the tier from their own policy,
 * because the tiers belong to the provider; this service turns a percentage
 * into money, calls Stripe, records the outcome and tells the user.
 *
 * A failed refund never undoes a cancellation. The cancellation stands and the
 * refund is recorded as FAILED, so it shows on the booking details and can be
 * retried, instead of a booking that is somehow half-cancelled.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectModel(Refund.name)
    private readonly refundModel: Model<Refund>,
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Issues a refund for a cancelled booking.
   *
   * Returns null when nothing is owed: a 0% tier produces no Stripe call and
   * no row, because PAY-03 only applies to a cancellation "with a positive
   * refund amount". A booking that was never paid returns null too.
   */
  async issueForCancellation(
    input: IssueRefundInput,
  ): Promise<RefundDocument | null> {
    const payment = await this.payments.findSucceededForBooking(
      input.bookingType,
      input.bookingId,
    );
    if (!payment) {
      // Nothing was ever captured, so there is nothing to give back. A hold
      // that expired or failed never took money.
      this.logger.log(
        `No succeeded payment for ${input.bookingType} booking ${input.bookingId}: no refund`,
      );
      return null;
    }

    // A provider cancellation is always full, whatever the tiers say.
    // Only a traveller's own cancellation follows the tiers; the provider or
    // the platform cancelling is always a full refund.
    const percentage =
      input.cancelledBy === CancelledBy.USER ? input.refundPercentage : 100;
    const captured = decimal128ToString(payment.amount) ?? '0.00';
    const amount = percentageOf(captured, percentage);

    if (isZero(amount)) {
      this.logger.log(
        `Refund share is ${percentage}% of ${captured}: nothing to refund for booking ${input.bookingId}`,
      );
      return null;
    }

    const existing = await this.findForBooking(
      input.bookingType,
      input.bookingId,
    );
    const live = existing.find(
      (refund) => refund.status !== RefundStatus.FAILED,
    );
    if (live) {
      // A cancellation that ran twice must not refund twice.
      throw new ConflictException({
        code: 'REFUND_ALREADY_ISSUED',
        message: 'This booking already has a refund',
      });
    }

    // The data model's invariant: total refunds never exceed what was
    // captured. With one refund per booking the check above already makes this
    // impossible, so this is a backstop rather than a live branch - it is what
    // would catch a mistake if partial or repeated refunds are ever added.
    const alreadyRefunded = existing
      .filter((refund) => refund.status === RefundStatus.REFUNDED)
      .reduce(
        (total, refund) =>
          addMoney(total, decimal128ToString(refund.amount) ?? '0.00'),
        '0.00',
      );
    if (isGreaterThan(addMoney(alreadyRefunded, amount), captured)) {
      throw new BadRequestException({
        code: 'REFUND_EXCEEDS_PAYMENT',
        message: 'A refund cannot exceed the amount that was captured',
      });
    }

    const refund = await this.refundModel.create({
      bookingType: input.bookingType,
      bookingId: new Types.ObjectId(input.bookingId),
      paymentId: payment._id,
      stripeRefundId: null,
      amount: toDecimal128(amount),
      currency: PLATFORM_CURRENCY,
      status: RefundStatus.PENDING,
      cancelledBy: input.cancelledBy,
      reason: input.reason,
      refundPercentage: percentage,
      policySnapshot: input.policySnapshot ?? null,
      // Numbered by attempt, so a retry after a failure gets its own key.
      idempotencyKey: `refund:${input.bookingType}:${input.bookingId}:${existing.length + 1}`,
      requestedAt: new Date(),
      completedAt: null,
      failureMessage: null,
    });

    return this.sendToStripe(refund, payment.stripePaymentIntentId);
  }

  /**
   * Retries a refund Stripe refused. The amount and the tier are taken from
   * the failed row, so a retry can never quietly refund a different amount.
   */
  async retryFailed(refundId: string): Promise<RefundDocument> {
    const refund = await this.findByIdOrThrow(refundId);
    if (refund.status !== RefundStatus.FAILED) {
      throw new ConflictException({
        code: 'REFUND_NOT_FAILED',
        message: `This refund is ${refund.status} and cannot be retried`,
      });
    }
    const payment = await this.payments.findById(refund.paymentId);
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return this.sendToStripe(refund, payment.stripePaymentIntentId);
  }

  /** PAY-03: the refunds of one booking, for the booking details screen. */
  async findForBooking(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundDocument[]> {
    if (!Types.ObjectId.isValid(bookingId)) {
      return [];
    }
    return this.refundModel
      .find({ bookingType, bookingId: new Types.ObjectId(bookingId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByIdOrThrow(refundId: string): Promise<RefundDocument> {
    if (!Types.ObjectId.isValid(refundId)) {
      throw new NotFoundException('Refund not found');
    }
    const refund = await this.refundModel.findById(refundId).exec();
    if (!refund) {
      throw new NotFoundException('Refund not found');
    }
    return refund;
  }

  /**
   * ACC-11: a refund is readable by the account that paid, found through the
   * payment rather than copied onto the refund. Anyone else gets the same 404
   * as for a refund that does not exist.
   */
  async findOwnOrThrow(
    userId: string,
    refundId: string,
  ): Promise<RefundDocument> {
    const refund = await this.findByIdOrThrow(refundId);
    const payment = await this.payments.findById(refund.paymentId);
    if (!payment || payment.userId.toString() !== userId) {
      throw new NotFoundException('Refund not found');
    }
    return this.refreshIfPending(refund);
  }

  /**
   * PAY-03: a refund Stripe has not settled yet is asked about again when the
   * user looks at it, so a missed refund webhook can never leave it PENDING
   * for ever. A Stripe error keeps the stored answer: reading a refund must
   * not fail because the payment provider is down.
   */
  async refreshIfPending(refund: RefundDocument): Promise<RefundDocument> {
    if (refund.status !== RefundStatus.PENDING || !refund.stripeRefundId) {
      return refund;
    }
    try {
      const current = await this.stripe.retrieveRefund(refund.stripeRefundId);
      return (await this.syncFromStripe(current)) ?? refund;
    } catch (error) {
      this.logger.warn(
        `Could not refresh refund ${refund._id.toString()} from Stripe: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return refund;
    }
  }

  /**
   * PAY-03: applies what Stripe now says about a refund (refund.updated,
   * refund.failed webhooks, or a refresh). Only a refund that is still
   * PENDING, or a REFUNDED one Stripe later reports as failed, can change,
   * and the change is one conditional update, so two deliveries of the same
   * news apply it once. Returns the refund as it now stands, or null when the
   * Stripe refund is not one of ours.
   */
  async syncFromStripe(
    stripeRefund: Pick<Stripe.Refund, 'id' | 'status' | 'failure_reason'>,
  ): Promise<RefundDocument | null> {
    const refund = await this.refundModel
      .findOne({ stripeRefundId: stripeRefund.id })
      .exec();
    if (!refund) {
      this.logger.warn(`No refund for Stripe refund ${stripeRefund.id}`);
      return null;
    }
    const next = fromStripeRefundStatus(stripeRefund.status ?? null);
    if (next === refund.status) {
      return refund;
    }
    const from =
      next === RefundStatus.FAILED
        ? [RefundStatus.PENDING, RefundStatus.REFUNDED]
        : [RefundStatus.PENDING];
    const updated = await this.refundModel
      .findOneAndUpdate(
        { _id: refund._id, status: { $in: from } },
        {
          $set: {
            status: next,
            completedAt: next === RefundStatus.REFUNDED ? new Date() : null,
            failureMessage:
              next === RefundStatus.FAILED
                ? (stripeRefund.failure_reason ?? 'Refund failed at Stripe')
                : null,
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
    if (updated) {
      this.logger.log(
        `Refund ${refund._id.toString()} is now ${next} (Stripe ${stripeRefund.id})`,
      );
    }
    return updated ?? refund;
  }

  /**
   * Calls Stripe and records the outcome.
   *
   * A Stripe failure is caught, not rethrown: the cancellation that asked for
   * this refund has already happened, so the right answer is a FAILED row the
   * user and an admin can see, not an error that makes the cancellation look
   * like it did not work.
   */
  private async sendToStripe(
    refund: RefundDocument,
    stripePaymentIntentId: string,
  ): Promise<RefundDocument> {
    const amount = decimal128ToString(refund.amount) ?? '0.00';
    try {
      const stripeRefund = await this.stripe.createRefund({
        stripePaymentIntentId,
        amount,
        idempotencyKey: refund.idempotencyKey,
        bookingId: refund.bookingId.toString(),
      });

      const status = fromStripeRefundStatus(stripeRefund.status);
      refund.stripeRefundId = stripeRefund.id;
      refund.status = status;
      refund.completedAt = status === RefundStatus.REFUNDED ? new Date() : null;
      refund.failureMessage = null;
      await refund.save();

      await this.notifyUser(refund, amount);
      return refund;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      refund.status = RefundStatus.FAILED;
      refund.failureMessage = message;
      await refund.save();
      this.logger.error(
        `Refund ${refund._id.toString()} of ${amount} ${refund.currency} failed`,
        error instanceof Error ? error.stack : message,
      );
      return refund;
    }
  }

  /** GEN-01: the user is told a refund is on its way. */
  private async notifyUser(
    refund: RefundDocument,
    amount: string,
  ): Promise<void> {
    const payment = await this.payments.findById(refund.paymentId);
    if (!payment) {
      return;
    }
    await this.notifications.notify({
      userId: payment.userId,
      type: NotificationType.REFUND_ISSUED,
      title: 'Refund issued',
      message:
        `${amount} ${refund.currency} is being refunded for your cancelled ` +
        `booking (${refund.refundPercentage}% of what you paid).`,
      resourceType: NotificationResourceType.REFUND,
      resourceId: refund._id.toString(),
    });
  }

}
