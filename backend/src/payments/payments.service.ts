import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus, BookingType } from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { PayableBooking } from '../common/bookings/bookings.port';
import { PLATFORM_CURRENCY, toDecimal128 } from '../common/money/money';
import { PaymentDto } from './dto/payment.dto';
import { PaymentIntentDto } from './dto/payment-intent.dto';
import {
  fromStripeStatus,
  OPEN_PAYMENT_STATUSES,
  PaymentStatus,
} from './payment-status.enum';
import { PolicyAcceptancesService } from './policy-acceptances.service';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { StripeService } from './stripe.service';

/**
 * PAY-01: paying for a booking that is on hold.
 *
 * The rules that matter, in one place:
 *  - only the booking's owner may pay for it (ACC-11);
 *  - the booking must still be PENDING_PAYMENT and its hold must not have run
 *    out, because the seats or rooms are only reserved while it is;
 *  - the provider's policies must have been accepted first (PAY-02);
 *  - a booking is never confirmed here. Confirmation happens in the webhook
 *    handler, from an event whose signature Stripe signed, so a client that
 *    claims to have paid cannot confirm anything.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<Payment>,
    private readonly stripe: StripeService,
    private readonly bookings: BookingsGateway,
    private readonly policies: PolicyAcceptancesService,
  ) {}

  /**
   * PAY-01: opens a payment for a booking, or hands back the attempt that is
   * already open.
   *
   * Asking twice does not create a second PaymentIntent: while an attempt is
   * REQUIRES_PAYMENT_METHOD or PROCESSING it is returned as it stands, with
   * its client secret, so a reloaded checkout page carries on where it was.
   */
  async createForBooking(
    userId: string,
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PaymentIntentDto> {
    const booking = await this.loadPayableBooking(
      userId,
      bookingType,
      bookingId,
    );
    const acceptance = await this.requireAcceptedPolicies(
      bookingType,
      bookingId,
    );

    const open = await this.findOpenPayment(bookingType, bookingId);
    if (open) {
      // Stripe is the authority on an existing intent: its status may have
      // moved on without a webhook having been handled yet.
      const refreshed = await this.syncWithStripe(open);
      if (OPEN_PAYMENT_STATUSES.includes(refreshed.status)) {
        const intent = await this.stripe.retrievePaymentIntent(
          refreshed.stripePaymentIntentId,
        );
        return PaymentIntentDto.from(refreshed, intent.client_secret);
      }
      if (refreshed.status === PaymentStatus.SUCCEEDED) {
        throw new ConflictException({
          code: 'ALREADY_PAID',
          message: 'This booking has already been paid for',
        });
      }
      // It failed or was cancelled: a new attempt is what retry is for.
      throw new ConflictException({
        code: 'PAYMENT_ATTEMPT_CLOSED',
        message:
          'The last payment attempt is closed. Retry it with POST ' +
          '/api/payments/{id}/retry.',
      });
    }

    return this.openAttempt(booking, acceptance._id, 1);
  }

  /**
   * PAY-01: "the user may retry until the hold expires".
   *
   * The hold is checked before anything is handed back, including the client
   * secret of an attempt that is still open: once the hold has gone the seats
   * or rooms have been released, so letting the user pay would sell inventory
   * the platform no longer has. Waiting for the expiry sweep to cancel the
   * PaymentIntent would leave exactly that window open.
   *
   * A declined card does not finish a PaymentIntent: Stripe puts it back to
   * requires_payment_method, so the same intent and client secret can be used
   * with another card. The retry therefore returns that intent, and only opens
   * a new one when the old attempt is really closed (cancelled).
   */
  async retry(userId: string, paymentId: string): Promise<PaymentIntentDto> {
    const payment = await this.loadOwnPayment(userId, paymentId);
    const current = await this.syncWithStripe(payment);

    if (current.status === PaymentStatus.SUCCEEDED) {
      throw new ConflictException({
        code: 'ALREADY_PAID',
        message: 'This payment already succeeded',
      });
    }

    const bookingId = current.bookingId.toString();
    const booking = await this.loadPayableBooking(
      userId,
      current.bookingType,
      bookingId,
    );
    const acceptance = await this.requireAcceptedPolicies(
      current.bookingType,
      bookingId,
    );

    if (OPEN_PAYMENT_STATUSES.includes(current.status)) {
      const intent = await this.stripe.retrievePaymentIntent(
        current.stripePaymentIntentId,
      );
      return PaymentIntentDto.from(current, intent.client_secret);
    }

    const attempts = await this.paymentModel
      .countDocuments({
        bookingType: current.bookingType,
        bookingId: current.bookingId,
      })
      .exec();
    return this.openAttempt(booking, acceptance._id, attempts + 1);
  }

  /** PAY-01: the payment's status, for the booking details screen. */
  async getOwn(userId: string, paymentId: string): Promise<PaymentDto> {
    const payment = await this.loadOwnPayment(userId, paymentId);
    // Reading it refreshes from Stripe, so a status is never stale just
    // because a webhook has not arrived.
    return PaymentDto.fromDocument(await this.syncWithStripe(payment));
  }

  /** Used by the webhook handler and by refunds (PAY-03). */
  async findByStripeId(
    stripePaymentIntentId: string,
  ): Promise<PaymentDocument | null> {
    return this.paymentModel.findOne({ stripePaymentIntentId }).exec();
  }

  /**
   * By id, with no ownership check: for other services in this module, such as
   * refunds resolving who paid. A route must use getOwn instead.
   */
  async findById(
    paymentId: string | Types.ObjectId,
  ): Promise<PaymentDocument | null> {
    if (typeof paymentId === 'string' && !Types.ObjectId.isValid(paymentId)) {
      return null;
    }
    return this.paymentModel.findById(paymentId).exec();
  }

  /**
   * The payment that paid for the booking itself: the oldest succeeded one. A
   * flight booking that was changed to a pricier flight has a second, later
   * one for the fare difference (FLT-27).
   */
  async findSucceededForBooking(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PaymentDocument | null> {
    if (!Types.ObjectId.isValid(bookingId)) {
      return null;
    }
    return this.paymentModel
      .findOne({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        status: PaymentStatus.SUCCEEDED,
      })
      .sort({ createdAt: 1, _id: 1 })
      .exec();
  }

  /** Every succeeded payment of a booking, oldest first: what refunds draw on. */
  async findSucceededPaymentsForBooking(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PaymentDocument[]> {
    if (!Types.ObjectId.isValid(bookingId)) {
      return [];
    }
    return this.paymentModel
      .find({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        status: PaymentStatus.SUCCEEDED,
      })
      .sort({ createdAt: 1, _id: 1 })
      .exec();
  }

  /**
   * FLT-27: records a fare difference Stripe has already confirmed, as a
   * SUCCEEDED payment of the same booking, so a later refund can give it back.
   * It is written only once the money is in, so the expiry sweep, which looks
   * at open payments, never sees it, and bookingConfirmedAt is set, so the
   * settlement leaves the webhook for its PaymentIntent alone. Recording the same
   * PaymentIntent twice returns the first row.
   */
  async recordFareDifference(input: {
    bookingType: BookingType;
    bookingId: string;
    userId: string;
    stripePaymentIntentId: string;
    amount: string;
  }): Promise<PaymentDocument | null> {
    const original = await this.findSucceededForBooking(
      input.bookingType,
      input.bookingId,
    );
    if (!original) {
      this.logger.error(
        `Fare difference ${input.stripePaymentIntentId} has no booking payment to belong to (${input.bookingType} ${input.bookingId})`,
      );
      return null;
    }
    try {
      return await this.paymentModel.create({
        bookingType: input.bookingType,
        bookingId: new Types.ObjectId(input.bookingId),
        userId: new Types.ObjectId(input.userId),
        stripePaymentIntentId: input.stripePaymentIntentId,
        amount: toDecimal128(input.amount),
        currency: PLATFORM_CURRENCY,
        status: PaymentStatus.SUCCEEDED,
        // The terms accepted for the booking still apply to it after a change.
        policyAcceptanceId: original.policyAcceptanceId,
        idempotencyKey: `fare-difference:${input.bookingType}:${input.bookingId}:${input.stripePaymentIntentId}`,
        attempt: original.attempt,
        succeededAt: new Date(),
        failedAt: null,
        cancelledAt: null,
        failureMessage: null,
        // Already applied to the booking by the change itself. Without this
        // the settlement (#80) would treat the PaymentIntent's webhook as a
        // second payment for a confirmed booking and refund the difference.
        bookingConfirmedAt: new Date(),
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        return this.findByStripeId(input.stripePaymentIntentId);
      }
      throw error;
    }
  }

  /**
   * Writes a status that came from a verified Stripe event or from a direct
   * read of the PaymentIntent.
   *
   * The filter carries the status the caller believed, so two deliveries of
   * the same event cannot both apply it: the second matches nothing and gets
   * null back, which is how the webhook handler knows not to repeat the side
   * effects.
   */
  async applyStatus(
    paymentId: Types.ObjectId,
    from: PaymentStatus,
    to: PaymentStatus,
    options: { failureMessage?: string | null; now?: Date } = {},
  ): Promise<PaymentDocument | null> {
    if (from === to) {
      return null;
    }
    const now = options.now ?? new Date();
    const update: Record<string, unknown> = { status: to };
    if (to === PaymentStatus.SUCCEEDED) update.succeededAt = now;
    if (to === PaymentStatus.FAILED) {
      update.failedAt = now;
      update.failureMessage = options.failureMessage ?? null;
    }
    if (to === PaymentStatus.CANCELLED) update.cancelledAt = now;

    return this.paymentModel
      .findOneAndUpdate(
        { _id: paymentId, status: from },
        { $set: update },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * Records that this payment's booking is confirmed. Only the first caller
   * gets true: the webhook and the expiry sweep can both settle the same
   * success, and only one of them may tell the user.
   */
  async markBookingConfirmed(paymentId: Types.ObjectId): Promise<boolean> {
    const updated = await this.paymentModel
      .findOneAndUpdate(
        { _id: paymentId, bookingConfirmedAt: null },
        { $set: { bookingConfirmedAt: new Date() } },
        { returnDocument: 'after' },
      )
      .exec();
    return updated !== null;
  }

  /** Open payments, for the hold-expiry sweep. */
  async findOpenPayments(limit: number): Promise<PaymentDocument[]> {
    return this.paymentModel
      .find({ status: { $in: OPEN_PAYMENT_STATUSES } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .exec();
  }

  private async openAttempt(
    booking: PayableBooking,
    policyAcceptanceId: Types.ObjectId,
    attempt: number,
  ): Promise<PaymentIntentDto> {
    const idempotencyKey = `pay:${booking.bookingType}:${booking.bookingId}:${attempt}`;

    const intent = await this.stripe.createPaymentIntent({
      amount: booking.totalAmount,
      idempotencyKey,
      bookingType: booking.bookingType,
      bookingId: booking.bookingId,
      userId: booking.userId,
    });

    try {
      const payment = await this.paymentModel.create({
        bookingType: booking.bookingType,
        bookingId: new Types.ObjectId(booking.bookingId),
        userId: new Types.ObjectId(booking.userId),
        stripePaymentIntentId: intent.id,
        amount: toDecimal128(booking.totalAmount),
        currency: PLATFORM_CURRENCY,
        status: fromStripeStatus(intent.status),
        policyAcceptanceId,
        idempotencyKey,
        attempt,
        succeededAt: null,
        failedAt: null,
        cancelledAt: null,
        failureMessage: null,
      });
      return PaymentIntentDto.from(payment, intent.client_secret);
    } catch (error) {
      if (isDuplicateKey(error)) {
        // Two requests raced. Stripe's idempotency key means they share one
        // PaymentIntent, so the row that won describes this attempt too.
        const winner = await this.findByStripeId(intent.id);
        if (winner) {
          return PaymentIntentDto.from(winner, intent.client_secret);
        }
      }
      throw error;
    }
  }

  /**
   * Brings a stored payment back in line with Stripe. Stripe is always the
   * authority: a webhook can be late, lost or still in flight, and a user
   * must not be told a payment failed when the money has gone.
   */
  private async syncWithStripe(
    payment: PaymentDocument,
  ): Promise<PaymentDocument> {
    const intent = await this.stripe.retrievePaymentIntent(
      payment.stripePaymentIntentId,
    );
    const actual = fromStripeStatus(intent.status);
    if (actual === payment.status) {
      return payment;
    }
    const updated = await this.applyStatus(
      payment._id,
      payment.status,
      actual,
      {
        failureMessage: intent.last_payment_error?.message ?? null,
      },
    );
    return updated ?? payment;
  }

  private async findOpenPayment(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PaymentDocument | null> {
    return this.paymentModel
      .findOne({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        status: { $in: OPEN_PAYMENT_STATUSES },
      })
      .sort({ attempt: -1 })
      .exec();
  }

  /** The booking has to be the caller's, on hold, and not expired. */
  private async loadPayableBooking(
    userId: string,
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PayableBooking> {
    const booking = await this.bookings.getPayableOrThrow(
      bookingType,
      bookingId,
    );
    if (booking.userId !== userId) {
      // Same answer as a booking that does not exist (ACC-11).
      throw new NotFoundException('Booking not found');
    }
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException({
        code: 'BOOKING_NOT_AWAITING_PAYMENT',
        message: `This booking is ${booking.status} and cannot be paid for`,
      });
    }
    if (
      booking.holdExpiresAt &&
      booking.holdExpiresAt.getTime() <= Date.now()
    ) {
      // The seats or rooms are no longer reserved, so taking money now would
      // sell something the platform does not have.
      throw new ConflictException({
        code: 'HOLD_EXPIRED',
        message:
          'The hold on this booking has expired. Start a new booking to ' +
          'reserve the seats or rooms again.',
      });
    }
    if (booking.currency !== PLATFORM_CURRENCY) {
      // PAY-04: everything is charged in one currency and never converted.
      this.logger.error(
        `Booking ${bookingId} is priced in ${booking.currency}, not ${PLATFORM_CURRENCY}`,
      );
      throw new ConflictException({
        code: 'UNSUPPORTED_BOOKING_CURRENCY',
        message: `Bookings must be priced in ${PLATFORM_CURRENCY}`,
      });
    }
    return booking;
  }

  /** PAY-02: no payment without an acceptance of the current terms. */
  private async requireAcceptedPolicies(
    bookingType: BookingType,
    bookingId: string,
  ) {
    const acceptance = await this.policies.findForBooking(
      bookingType,
      bookingId,
    );
    if (!acceptance) {
      throw new ForbiddenException({
        code: 'POLICIES_NOT_ACCEPTED',
        message:
          'Accept the provider policies first: POST /api/bookings/' +
          `${bookingType.toLowerCase()}/${bookingId}/accept-policies`,
      });
    }
    return acceptance;
  }

  private async loadOwnPayment(
    userId: string,
    paymentId: string,
  ): Promise<PaymentDocument> {
    if (!Types.ObjectId.isValid(paymentId)) {
      throw new NotFoundException('Payment not found');
    }
    const payment = await this.paymentModel.findById(paymentId).exec();
    // Another account's payment is indistinguishable from one that is not
    // there, so payment ids cannot be probed (ACC-11).
    if (!payment || payment.userId.toString() !== userId) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
