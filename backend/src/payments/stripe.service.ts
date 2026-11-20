import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { BookingType } from '../common/bookings/booking-status';
import {
  formatMoney,
  isGreaterThan,
  PLATFORM_CURRENCY,
  toMinorUnits,
} from '../common/money/money';

/**
 * Stripe's smallest charge in USD. A PaymentIntent below it is refused by
 * Stripe, so it is refused here first with a clear 400 (PAY-01, FLT-27).
 */
export const STRIPE_MINIMUM_CHARGE = '0.50';

export interface CreatePaymentIntentInput {
  /** Decimal string in the platform currency, e.g. "199.99". */
  amount: string;
  /** Sent to Stripe so the same request cannot open two PaymentIntents. */
  idempotencyKey: string;
  bookingType: BookingType;
  bookingId: string;
  userId: string;
}

export interface CreateRefundInput {
  stripePaymentIntentId: string;
  amount: string;
  idempotencyKey: string;
  bookingId: string;
}

/**
 * The only place this backend talks to Stripe.
 *
 * Everything runs in test mode (PAY-01). Card number, CVC and expiry never
 * come through here: the user sends them to Stripe directly with Stripe
 * Elements, using the client secret this service returns, so the backend only
 * ever handles PaymentIntent ids, amounts and statuses.
 *
 * The secret key is optional. Without it the rest of the application still
 * starts and every other module works, and the payment endpoints answer 503
 * with a clear message rather than the whole app refusing to boot - which
 * matters on a team where only the people demonstrating payments hold a key.
 */
@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe | null;
  private readonly webhookSecret: string | undefined;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    this.client = secretKey ? new Stripe(secretKey) : null;
  }

  onModuleInit(): void {
    if (!this.client) {
      this.logger.warn(
        'STRIPE_SECRET_KEY is not set: the payment endpoints will answer 503. ' +
          'Set it in backend/.env to use them.',
      );
    } else if (!this.webhookSecret) {
      this.logger.warn(
        'STRIPE_WEBHOOK_SECRET is not set: POST /api/payments/webhook will ' +
          'reject every delivery, because an unverified event is not trusted.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * PAY-01: opens a PaymentIntent for a booking.
   *
   * The booking type and id travel in metadata, so the webhook can find the
   * booking from Stripe's event alone, and automatic_payment_methods lets
   * Stripe decide what the test-mode user may pay with.
   */
  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<Stripe.PaymentIntent> {
    if (isGreaterThan(STRIPE_MINIMUM_CHARGE, input.amount)) {
      throw new BadRequestException({
        code: 'AMOUNT_TOO_SMALL',
        message:
          `Card payments must be at least ${STRIPE_MINIMUM_CHARGE} ` +
          `${PLATFORM_CURRENCY}; this one is ${formatMoney(input.amount)}`,
        errors: [
          {
            field: 'amount',
            messages: [`must be at least ${STRIPE_MINIMUM_CHARGE}`],
          },
        ],
      });
    }
    const stripe = this.require();
    return this.translate(() =>
      stripe.paymentIntents.create(
        {
          amount: toMinorUnits(input.amount),
          currency: PLATFORM_CURRENCY.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          metadata: {
            bookingType: input.bookingType,
            bookingId: input.bookingId,
            userId: input.userId,
          },
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
  }

  /** The current state at Stripe, which is always the authority. */
  async retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    const stripe = this.require();
    return this.translate(() => stripe.paymentIntents.retrieve(id));
  }

  /**
   * PAY-01: when the hold expires the PaymentIntent is cancelled, so a late
   * confirmation cannot take money for inventory that has gone back.
   *
   * Cancelling one that Stripe has already cancelled is not an error here: the
   * desired end state is the same, and the sweep must be safe to repeat.
   */
  async cancelPaymentIntent(id: string): Promise<Stripe.PaymentIntent | null> {
    const stripe = this.require();
    try {
      return await stripe.paymentIntents.cancel(id);
    } catch (error) {
      if (isAlreadyFinished(error)) {
        this.logger.log(
          `PaymentIntent ${id} could not be cancelled because Stripe has ` +
            'already finished it',
        );
        return null;
      }
      throw this.toHttpError(error);
    }
  }

  /** PAY-03: a refund as Stripe sees it now, to settle one still PENDING. */
  async retrieveRefund(id: string): Promise<Stripe.Refund> {
    const stripe = this.require();
    return this.translate(() => stripe.refunds.retrieve(id));
  }

  /** PAY-03: refunds part or all of a captured payment. */
  async createRefund(input: CreateRefundInput): Promise<Stripe.Refund> {
    const stripe = this.require();
    return this.translate(() =>
      stripe.refunds.create(
        {
          payment_intent: input.stripePaymentIntentId,
          amount: toMinorUnits(input.amount),
          metadata: { bookingId: input.bookingId },
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
  }

  /**
   * PAY-01: verifies that a webhook really came from Stripe.
   *
   * The signature is checked against the raw request bytes, not the parsed
   * JSON, because re-serialising changes the bytes and breaks the signature.
   * An unverified body is never acted on: that is the whole reason a booking
   * is confirmed from the webhook rather than from the browser saying "paid".
   */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const stripe = this.require();
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException({
        code: 'WEBHOOK_NOT_CONFIGURED',
        message: 'STRIPE_WEBHOOK_SECRET is not set',
      });
    }
    try {
      return stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (error) {
      // Deliberately vague: a caller guessing at signatures learns nothing.
      this.logger.warn(
        `Rejected a webhook with an invalid signature: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Invalid webhook signature',
      });
    }
  }

  private require(): Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: 'PAYMENTS_UNAVAILABLE',
        message:
          'Payments are not configured on this server: STRIPE_SECRET_KEY is ' +
          'missing',
      });
    }
    return this.client;
  }

  private async translate<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  /**
   * Turns a Stripe error into one of ours.
   *
   * A card error is the user's problem and becomes a 400 with Stripe's own
   * message, which is written for end users. Anything else is ours: it is
   * logged in full and surfaced as 503, because a Stripe outage is not a bad
   * request and the client should retry rather than change the request.
   */
  private toHttpError(error: unknown): Error {
    if (error instanceof Stripe.errors.StripeCardError) {
      return new BadRequestException({
        code: 'CARD_DECLINED',
        message: error.message,
      });
    }
    if (error instanceof Stripe.errors.StripeInvalidRequestError) {
      this.logger.error(`Stripe rejected a request: ${error.message}`);
      return new BadRequestException({
        code: 'STRIPE_REQUEST_REJECTED',
        message: error.message,
      });
    }
    this.logger.error(
      'Stripe call failed',
      error instanceof Error ? error.stack : String(error),
    );
    return new ServiceUnavailableException({
      code: 'STRIPE_UNAVAILABLE',
      message: 'The payment provider is unavailable, please try again',
    });
  }
}

/**
 * Stripe refuses to cancel a PaymentIntent that has succeeded or is already
 * cancelled. For the expiry sweep that is the end state it wanted anyway (and
 * the sweep then reads the intent to learn which of the two it was).
 *
 * Stripe's error code is what identifies it: the message has changed wording
 * before ("You cannot cancel this PaymentIntent because it has a status of
 * succeeded"), and a pattern that only knew the old wording let every such
 * refusal through as a failure, so the sweep could never settle the payment.
 * The message is kept as a fallback for an error that arrives without a code.
 */
function isAlreadyFinished(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
    return false;
  }
  if (error.code === 'payment_intent_unexpected_state') {
    return true;
  }
  return (
    typeof error.message === 'string' &&
    /cannot be canceled|already (been )?(canceled|succeeded)|has a status of (succeeded|canceled)/i.test(
      error.message,
    )
  );
}
