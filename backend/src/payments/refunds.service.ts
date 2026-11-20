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
  subtractMoney,
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
  RefundKind,
  RefundStatus,
} from './refund-status.enum';
import type { PaymentDocument } from './schemas/payment.schema';
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

/** A booking's succeeded payments and what each still has to give back. */
interface Ledger {
  bookingType: BookingType;
  bookingId: string;
  payments: PaymentDocument[];
  refunds: RefundDocument[];
  /** Payment id -> captured less its live refunds. */
  refundable: Map<string, string>;
  refundableTotal: string;
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
    const ledger = await this.ledger(input.bookingType, input.bookingId);
    if (ledger.payments.length === 0) {
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

    // Checked first: a cancellation that ran twice must be refused, not
    // quietly answered "nothing left to refund".
    const live = ledger.refunds.find(
      (refund) =>
        refund.status !== RefundStatus.FAILED &&
        (refund.kind ?? RefundKind.CANCELLATION) === RefundKind.CANCELLATION,
    );
    if (live) {
      throw new ConflictException({
        code: 'REFUND_ALREADY_ISSUED',
        message: 'This booking already has a refund',
      });
    }

    // The share is of what is still paid: everything captured (the booking
    // and any fare difference, FLT-27) less what has already gone back (a
    // cheaper flight's difference). That is the booking's current total, the
    // same figure the cancellation quote shows.
    const stillPaid = ledger.refundableTotal;
    const amount = percentageOf(stillPaid, percentage);

    if (isZero(amount)) {
      this.logger.log(
        `Refund share is ${percentage}% of ${stillPaid}: nothing to refund for booking ${input.bookingId}`,
      );
      return null;
    }

    return this.allocate(ledger, amount, {
      kind: RefundKind.CANCELLATION,
      cancelledBy: input.cancelledBy,
      reason: input.reason,
      refundPercentage: percentage,
      policySnapshot: input.policySnapshot ?? null,
    });
  }

  /**
   * FLT-27: gives back the fare difference when a confirmed flight booking
   * moves to a cheaper flight. Recorded, sent to Stripe and notified exactly
   * like a cancellation refund (PAY-03), as kind FARE_DIFFERENCE, so it never
   * blocks the cancellation refund that may come later and that one is worked
   * out from what is still paid. Returns the first refund row, or null when
   * nothing was captured.
   */
  async issueFareDifference(input: {
    bookingType: BookingType;
    bookingId: string;
    amount: string;
    reason: string;
  }): Promise<RefundDocument | null> {
    const ledger = await this.ledger(input.bookingType, input.bookingId);
    if (ledger.payments.length === 0 || isZero(input.amount)) {
      return null;
    }
    const captured = ledger.payments.reduce(
      (total, payment) =>
        addMoney(total, decimal128ToString(payment.amount) ?? '0.00'),
      '0.00',
    );
    // The share of everything captured, for the record and the notice.
    const share = Math.min(
      100,
      Math.round((Number(input.amount) / Number(captured)) * 10_000) / 100,
    );
    return this.allocate(ledger, input.amount, {
      kind: RefundKind.FARE_DIFFERENCE,
      cancelledBy: CancelledBy.USER,
      reason: input.reason,
      refundPercentage: share,
      policySnapshot: null,
    });
  }

  /**
   * What a booking has paid and what is already on its way back. A refund is
   * only ever drawn from a payment that still has that much left on it, which
   * is the invariant "refunds never exceed what was captured", per payment.
   * FAILED refunds returned nothing, so they do not count.
   */
  private async ledger(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<Ledger> {
    const [payments, refunds] = await Promise.all([
      this.payments.findSucceededPaymentsForBooking(bookingType, bookingId),
      this.findForBooking(bookingType, bookingId),
    ]);
    const refundable = new Map<string, string>();
    for (const payment of payments) {
      const returned = refunds
        .filter(
          (refund) =>
            refund.status !== RefundStatus.FAILED &&
            refund.paymentId.toString() === payment._id.toString(),
        )
        .reduce(
          (total, refund) =>
            addMoney(total, decimal128ToString(refund.amount) ?? '0.00'),
          '0.00',
        );
      const captured = decimal128ToString(payment.amount) ?? '0.00';
      refundable.set(
        payment._id.toString(),
        isGreaterThan(returned, captured)
          ? '0.00'
          : subtractMoney(captured, returned),
      );
    }
    const refundableTotal = [...refundable.values()].reduce(
      (total, left) => addMoney(total, left),
      '0.00',
    );
    return {
      bookingType,
      bookingId,
      payments,
      refunds,
      refundable,
      refundableTotal,
    };
  }

  /**
   * Refunds `amount`, newest payment first, never more from a payment than it
   * has left: a fare difference paid on top of the booking goes back before
   * the booking's own payment. Usually one payment covers it and this writes
   * one row. Each row is written before Stripe is called. Returns the first.
   */
  private async allocate(
    ledger: Ledger,
    amount: string,
    fields: {
      kind: RefundKind;
      cancelledBy: CancelledBy;
      reason: string;
      refundPercentage: number;
      policySnapshot: Record<string, unknown> | null;
    },
  ): Promise<RefundDocument | null> {
    if (isGreaterThan(amount, ledger.refundableTotal)) {
      throw new BadRequestException({
        code: 'REFUND_EXCEEDS_PAYMENT',
        message: 'A refund cannot exceed the amount that was captured',
      });
    }
    let owed = amount;
    let written = 0;
    let first: RefundDocument | null = null;
    for (const payment of [...ledger.payments].reverse()) {
      if (isZero(owed)) {
        break;
      }
      const left = ledger.refundable.get(payment._id.toString()) ?? '0.00';
      if (isZero(left)) {
        continue;
      }
      const slice = isGreaterThan(owed, left) ? left : owed;
      owed = subtractMoney(owed, slice);
      written += 1;
      const refund = await this.refundModel.create({
        bookingType: ledger.bookingType,
        bookingId: new Types.ObjectId(ledger.bookingId),
        paymentId: payment._id,
        stripeRefundId: null,
        amount: toDecimal128(slice),
        currency: PLATFORM_CURRENCY,
        status: RefundStatus.PENDING,
        cancelledBy: fields.cancelledBy,
        kind: fields.kind,
        reason: fields.reason,
        refundPercentage: fields.refundPercentage,
        policySnapshot: fields.policySnapshot,
        // Numbered per booking, so a retry after a failure gets its own key.
        idempotencyKey: `refund:${ledger.bookingType}:${ledger.bookingId}:${ledger.refunds.length + written}`,
        requestedAt: new Date(),
        completedAt: null,
        failureMessage: null,
      });
      const sent = await this.sendToStripe(
        refund,
        payment.stripePaymentIntentId,
      );
      first = first ?? sent;
    }
    return first;
  }

  /**
   * PAY-01: gives back, in full, one payment whose booking could not take it:
   * the money arrived after the hold ran out, the booking was already
   * confirmed by another payment, or the booking is gone.
   *
   * Keyed on the payment, not the booking. In a double payment the booking
   * keeps the payment that confirmed it, and only this one is returned;
   * issueForCancellation, which looks up "the" succeeded payment of a booking,
   * could pick the wrong one. Safe to repeat - the webhook and the expiry
   * sweep can both settle the same payment - because a payment gets at most
   * one such refund, and one that already has a live refund of any kind is
   * left alone. `created` says whether this call made it, so the caller tells
   * the user once.
   */
  async refundUnconfirmablePayment(
    payment: PaymentDocument,
    reason: string,
  ): Promise<{ refund: RefundDocument; created: boolean }> {
    const existing = await this.refundModel
      .find({ paymentId: payment._id })
      .sort({ createdAt: -1 })
      .exec();
    const live = existing.find(
      (refund) => refund.status !== RefundStatus.FAILED,
    );
    if (live) {
      return { refund: live, created: false };
    }
    const idempotencyKey = `refund:unconfirmed:${payment._id.toString()}`;
    const failed = existing.find(
      (refund) => refund.idempotencyKey === idempotencyKey,
    );
    if (failed) {
      // The same refund failed at Stripe before: send that row again, with
      // its key, rather than a second one.
      return {
        refund: await this.sendToStripe(failed, payment.stripePaymentIntentId),
        created: false,
      };
    }

    const amount = decimal128ToString(payment.amount) ?? '0.00';
    let refund: RefundDocument;
    try {
      refund = await this.refundModel.create({
        bookingType: payment.bookingType,
        bookingId: payment.bookingId,
        paymentId: payment._id,
        stripeRefundId: null,
        amount: toDecimal128(amount),
        currency: payment.currency,
        status: RefundStatus.PENDING,
        cancelledBy: CancelledBy.SYSTEM,
        kind: RefundKind.UNCONFIRMED_PAYMENT,
        reason,
        refundPercentage: 100,
        policySnapshot: null,
        idempotencyKey,
        requestedAt: new Date(),
        completedAt: null,
        failureMessage: null,
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        // Another caller created it a moment ago; that one is sending it.
        const winner = await this.refundModel
          .findOne({ idempotencyKey })
          .exec();
        if (winner) return { refund: winner, created: false };
      }
      throw error;
    }
    this.logger.warn(
      `Refunding payment ${payment._id.toString()} in full ` +
        `(${amount} ${payment.currency}): ${reason}`,
    );
    return {
      refund: await this.sendToStripe(refund, payment.stripePaymentIntentId),
      created: true,
    };
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
      message: refundNotice(refund, amount),
      resourceType: NotificationResourceType.REFUND,
      resourceId: refund._id.toString(),
    });
  }
}

/** GEN-01: the refund in the user's words; only a cancellation says "cancelled". */
function refundNotice(refund: RefundDocument, amount: string): string {
  const money = `${amount} ${refund.currency} is being refunded`;
  switch (refund.kind) {
    case RefundKind.FARE_DIFFERENCE:
      return `${money}: the fare difference after your booking moved to a cheaper flight.`;
    case RefundKind.UNCONFIRMED_PAYMENT:
      return `${money} in full: this payment could not be applied to your booking.`;
    default:
      return `${money} for your cancelled booking (${refund.refundPercentage}% of what you paid).`;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
