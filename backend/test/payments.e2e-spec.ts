// PAY-01 end to end against the shared database.
//
// What is real here: the HTTP routes, the guards, the validation, the
// payments and stripeWebhookEvents collections, and - importantly - the
// webhook signature verification, which is local crypto and needs no network.
// A correctly signed delivery confirms the booking; a tampered one is refused.
//
// What is stood in for: Stripe's HTTP API (no account or network is used, and
// STRIPE_SECRET_KEY in .env is a placeholder) and the BookingsPort that the
// flights and hotels modules will provide. When A1 and B2 wire their ports in,
// only the stand-in below goes away.
import { INestApplication, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from './../src/common/bookings/booking-status';
import { BookingsGateway } from './../src/common/bookings/bookings.gateway';
import { PaymentExpiryService } from './../src/payments/payment-expiry.service';
import { PaymentStatus } from './../src/payments/payment-status.enum';
import { Payment } from './../src/payments/schemas/payment.schema';
import { PolicyAcceptance } from './../src/payments/schemas/policy-acceptance.schema';
import { StripeWebhookEvent } from './../src/payments/schemas/stripe-webhook-event.schema';
import { StripeService } from './../src/payments/stripe.service';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

const PROVIDER_ID = '6720f1c2a1b2c3d4e5f60800';
const POLICY_SNAPSHOT = { checkInTime: '14:00', checkOutTime: '12:00' };
// Signed with whatever the application verifies against, so these tests work
// with any teammate's STRIPE_WEBHOOK_SECRET rather than one hard-coded here.
// ConfigModule loads backend/.env, so the value is there by the time this runs.
function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is not set: copy backend/.env.example to .env ' +
        'and give it any whsec_ value to run the webhook tests.',
    );
  }
  return secret;
}

describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let paymentModel: Model<Payment>;
  let acceptanceModel: Model<PolicyAcceptance>;
  let eventModel: Model<StripeWebhookEvent>;
  let stripeSigner: Stripe;

  const createdUserIds: string[] = [];
  let owner: SignedInUser;
  let other: SignedInUser;

  // The stand-in booking, reshaped per test.
  let bookingId: string;
  let bookingStatus: BookingStatus;
  let holdExpiresAt: Date | null;
  let totalAmount: string;
  let bookingCurrency: string;
  let confirmedReference: string;
  let confirmCalls: string[];
  let releaseCalls: string[];

  // The stand-in Stripe, reshaped per test.
  let intentCounter = 0;
  /** Status of each stand-in PaymentIntent, keyed by its id. */
  let intentStatuses: Record<string, string>;
  /** Status a newly created intent starts in. */
  let newIntentStatus: string;
  let createdIntents: { amount: number; idempotencyKey: string }[];
  let cancelledIntents: string[];

  /** Moves one intent to a new status, as Stripe would. */
  function setIntentStatus(intentId: string, status: string): void {
    intentStatuses[intentId] = status;
  }

  function standInForBookingModule(): void {
    const gateway = app.get(BookingsGateway);
    jest.spyOn(gateway, 'getPayableOrThrow').mockImplementation((type, id) => {
      if (id !== bookingId) {
        return Promise.reject(new NotFoundException('Booking not found'));
      }
      return Promise.resolve({
        bookingId,
        bookingType: type,
        userId: owner.userId,
        status: bookingStatus,
        totalAmount,
        currency: bookingCurrency,
        holdExpiresAt,
        bookingReference: null,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
      });
    });
    jest.spyOn(gateway, 'getPoliciesOrThrow').mockImplementation((type, id) =>
      Promise.resolve({
        bookingId: id,
        bookingType: type,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
        policyVersion: 1,
        policySnapshot: POLICY_SNAPSHOT,
      }),
    );
    jest
      .spyOn(gateway, 'confirmAfterPayment')
      .mockImplementation((type, id) => {
        confirmCalls.push(id);
        return Promise.resolve({
          bookingId: id,
          status: BookingStatus.CONFIRMED,
          bookingReference: confirmedReference,
        });
      });
    jest.spyOn(gateway, 'releaseHold').mockImplementation((type, id) => {
      releaseCalls.push(id);
      return Promise.resolve();
    });
  }

  /** Stands in for Stripe's HTTP API. Signature verification stays real. */
  function standInForStripeApi(): void {
    const stripe = app.get(StripeService);
    jest.spyOn(stripe, 'createPaymentIntent').mockImplementation((input) => {
      intentCounter += 1;
      const id = `pi_e2e_${Date.now()}_${intentCounter}`;
      createdIntents.push({
        amount: Math.round(Number(input.amount) * 100),
        idempotencyKey: input.idempotencyKey,
      });
      intentStatuses[id] = newIntentStatus;
      return Promise.resolve({
        id,
        status: newIntentStatus,
        client_secret: `${id}_secret_test`,
      } as never);
    });
    jest.spyOn(stripe, 'retrievePaymentIntent').mockImplementation((id) =>
      Promise.resolve({
        id,
        status: intentStatuses[id] ?? 'requires_payment_method',
        client_secret: `${id}_secret_test`,
      } as never),
    );
    jest.spyOn(stripe, 'cancelPaymentIntent').mockImplementation((id) => {
      cancelledIntents.push(id);
      intentStatuses[id] = 'canceled';
      return Promise.resolve(null);
    });
  }

  /** A real Stripe-signed webhook delivery. */
  function deliverWebhook(
    type: string,
    paymentIntentId: string,
    options: {
      eventId?: string;
      tamper?: boolean;
      secret?: string;
      lastError?: string;
    } = {},
  ) {
    const body = JSON.stringify({
      id: options.eventId ?? `evt_e2e_${Date.now()}_${Math.random()}`,
      object: 'event',
      type,
      data: {
        object: {
          id: paymentIntentId,
          object: 'payment_intent',
          metadata: { bookingId, bookingType: BookingType.HOTEL },
          ...(options.lastError
            ? { last_payment_error: { message: options.lastError } }
            : {}),
        },
      },
    });
    const signature = stripeSigner.webhooks.generateTestHeaderString({
      payload: body,
      secret: options.secret ?? webhookSecret(),
    });
    const sent = options.tamper
      ? body.replace(paymentIntentId, 'pi_other')
      : body;

    return request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(sent);
  }

  function acceptPolicies(user: SignedInUser = owner) {
    return request(app.getHttpServer())
      .post(`/api/bookings/hotel/${bookingId}/accept-policies`)
      .set('Cookie', user.cookie)
      .send({ accepted: true, policyVersion: 1 });
  }

  function startPayment(user: SignedInUser = owner) {
    return request(app.getHttpServer())
      .post('/api/payments')
      .set('Cookie', user.cookie)
      .send({ bookingType: BookingType.HOTEL, bookingId });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // rawBody, exactly as main.ts creates it: the webhook signature is checked
    // against the bytes Stripe signed.
    app = moduleFixture.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();

    paymentModel = app.get<Model<Payment>>(getModelToken(Payment.name));
    acceptanceModel = app.get<Model<PolicyAcceptance>>(
      getModelToken(PolicyAcceptance.name),
    );
    eventModel = app.get<Model<StripeWebhookEvent>>(
      getModelToken(StripeWebhookEvent.name),
    );
    stripeSigner = new Stripe('sk_test_placeholder');

    owner = await createSignedInUser(app, { label: 'pay-owner' });
    other = await createSignedInUser(app, { label: 'pay-other' });
    createdUserIds.push(owner.userId, other.userId);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    const userIds = createdUserIds.map((id) => new Types.ObjectId(id));
    await paymentModel.deleteMany({ userId: { $in: userIds } }).exec();
    await acceptanceModel.deleteMany({ userId: { $in: userIds } }).exec();
    await eventModel.deleteMany({ stripeEventId: /^evt_e2e_/ }).exec();
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  beforeEach(() => {
    bookingId = new Types.ObjectId().toString();
    bookingStatus = BookingStatus.PENDING_PAYMENT;
    holdExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    totalAmount = '420.00';
    bookingCurrency = 'USD';
    confirmedReference = `NILE-${Math.floor(Math.random() * 9000) + 1000}`;
    confirmCalls = [];
    releaseCalls = [];
    intentStatuses = {};
    newIntentStatus = 'requires_payment_method';
    createdIntents = [];
    cancelledIntents = [];
    standInForBookingModule();
    standInForStripeApi();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/payments', () => {
    it(
      'opens a payment and returns the client secret',
      async () => {
        await acceptPolicies().expect(200);

        const res = await startPayment().expect(201);

        expect(res.body).toMatchObject({
          bookingType: BookingType.HOTEL,
          bookingId,
          amount: '420.00',
          currency: 'USD',
          status: PaymentStatus.REQUIRES_PAYMENT_METHOD,
          attempt: 1,
        });
        expect(res.body.clientSecret).toMatch(/_secret_test$/);
        expect(res.body.nextStep).toContain('Stripe Elements');
        // The amount charged comes from the booking, as whole cents.
        expect(createdIntents[0].amount).toBe(42000);
      },
      SLOW_MS,
    );

    // PAY-01: only the Stripe id, amount, currency and status are stored.
    it(
      'stores nothing resembling a card detail',
      async () => {
        await acceptPolicies().expect(200);
        const res = await startPayment().expect(201);

        const stored = await paymentModel.findById(res.body.id).lean().exec();
        expect(JSON.stringify(stored)).not.toMatch(
          /card|cvc|cvv|expiry|exp_month|pan/i,
        );
        expect(stored?.stripePaymentIntentId).toMatch(/^pi_e2e_/);
      },
      SLOW_MS,
    );

    // PAY-02 is the gate in front of PAY-01.
    it(
      'refuses before the policies are accepted (403)',
      async () => {
        const res = await startPayment().expect(403);

        expect(res.body.code).toBe('POLICIES_NOT_ACCEPTED');
        await expect(
          paymentModel
            .countDocuments({ bookingId: new Types.ObjectId(bookingId) })
            .exec(),
        ).resolves.toBe(0);
      },
      SLOW_MS,
    );

    it(
      'refuses once the hold has expired (409)',
      async () => {
        await acceptPolicies().expect(200);
        holdExpiresAt = new Date(Date.now() - 1000);

        const res = await startPayment().expect(409);

        expect(res.body.code).toBe('HOLD_EXPIRED');
      },
      SLOW_MS,
    );

    it(
      'refuses a booking priced in another currency (409)',
      async () => {
        await acceptPolicies().expect(200);
        bookingCurrency = 'EGP';

        const res = await startPayment().expect(409);

        expect(res.body.code).toBe('UNSUPPORTED_BOOKING_CURRENCY');
      },
      SLOW_MS,
    );

    it(
      'returns the open attempt rather than a second PaymentIntent',
      async () => {
        await acceptPolicies().expect(200);
        const first = await startPayment().expect(201);

        const second = await startPayment().expect(201);

        expect(second.body.id).toBe(first.body.id);
        expect(createdIntents).toHaveLength(1);
      },
      SLOW_MS,
    );

    it(
      'answers 404 for another account’s booking',
      async () => {
        await acceptPolicies().expect(200);

        const res = await startPayment(other).expect(404);

        expect(res.body.code).toBe('NOT_FOUND');
      },
      SLOW_MS,
    );

    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .send({ bookingType: BookingType.HOTEL, bookingId })
        .expect(401);
    });

    it.each([
      [{ bookingId: '6720f1c2a1b2c3d4e5f60718' }, 'bookingType'],
      [
        { bookingType: 'CRUISE', bookingId: '6720f1c2a1b2c3d4e5f60718' },
        'bookingType',
      ],
      [{ bookingType: 'HOTEL' }, 'bookingId'],
      [{ bookingType: 'HOTEL', bookingId: 'nope' }, 'bookingId'],
      [
        {
          bookingType: 'HOTEL',
          bookingId: '6720f1c2a1b2c3d4e5f60718',
          amount: '1.00',
        },
        'amount',
      ],
    ])('rejects the body %o with a field error on %s', async (body, field) => {
      const res = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Cookie', owner.cookie)
        .send(body)
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
        field,
      );
    });
  });

  describe('POST /api/payments/webhook', () => {
    async function openPayment(): Promise<{ id: string; intentId: string }> {
      await acceptPolicies().expect(200);
      const res = await startPayment().expect(201);
      return { id: res.body.id, intentId: res.body.stripePaymentIntentId };
    }

    it(
      'confirms the booking on a correctly signed success',
      async () => {
        const payment = await openPayment();
        setIntentStatus(payment.intentId, 'succeeded');

        const res = await deliverWebhook(
          'payment_intent.succeeded',
          payment.intentId,
        ).expect(200);

        expect(res.body).toMatchObject({ received: true, status: 'PROCESSED' });
        expect(confirmCalls).toEqual([bookingId]);

        const stored = await paymentModel.findById(payment.id).exec();
        expect(stored?.status).toBe(PaymentStatus.SUCCEEDED);
        expect(stored?.succeededAt).toBeInstanceOf(Date);
      },
      SLOW_MS,
    );

    it(
      'tells the user the booking is confirmed (GEN-01)',
      async () => {
        const payment = await openPayment();
        setIntentStatus(payment.intentId, 'succeeded');
        await deliverWebhook(
          'payment_intent.succeeded',
          payment.intentId,
        ).expect(200);

        const notifications = await request(app.getHttpServer())
          .get('/api/notifications')
          .set('Cookie', owner.cookie)
          .expect(200);

        expect(notifications.body.items[0]).toMatchObject({
          type: 'BOOKING_CONFIRMED',
          resourceType: 'HOTEL_BOOKING',
          resourceId: bookingId,
        });
        expect(notifications.body.items[0].message).toContain(
          confirmedReference,
        );
      },
      SLOW_MS,
    );

    // The reason a booking is confirmed from the webhook and not from the
    // browser: a body nobody signed proves nothing.
    it(
      'refuses an unsigned delivery and confirms nothing (400)',
      async () => {
        const payment = await openPayment();

        const res = await request(app.getHttpServer())
          .post('/api/payments/webhook')
          .set('Content-Type', 'application/json')
          .send({
            id: 'evt_e2e_forged',
            type: 'payment_intent.succeeded',
            data: {
              object: { id: payment.intentId, object: 'payment_intent' },
            },
          })
          .expect(400);

        expect(res.body.code).toBe('MISSING_WEBHOOK_SIGNATURE');
        expect(confirmCalls).toEqual([]);
      },
      SLOW_MS,
    );

    it(
      'refuses a signature made with the wrong secret (401)',
      async () => {
        const payment = await openPayment();

        const res = await deliverWebhook(
          'payment_intent.succeeded',
          payment.intentId,
          { secret: 'whsec_someoneelsessecret' },
        ).expect(401);

        expect(res.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');
        expect(confirmCalls).toEqual([]);
      },
      SLOW_MS,
    );

    it(
      'refuses a body changed after it was signed (401)',
      async () => {
        const payment = await openPayment();

        const res = await deliverWebhook(
          'payment_intent.succeeded',
          payment.intentId,
          { tamper: true },
        ).expect(401);

        expect(res.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');
        expect(confirmCalls).toEqual([]);
      },
      SLOW_MS,
    );

    // Stripe retries until it gets a 2xx and can deliver the same event twice.
    it(
      'confirms once even when the same event arrives twice',
      async () => {
        const payment = await openPayment();
        setIntentStatus(payment.intentId, 'succeeded');
        const eventId = `evt_e2e_dup_${Date.now()}`;

        await deliverWebhook('payment_intent.succeeded', payment.intentId, {
          eventId,
        }).expect(200);
        await deliverWebhook('payment_intent.succeeded', payment.intentId, {
          eventId,
        }).expect(200);

        expect(confirmCalls).toEqual([bookingId]);
        await expect(
          eventModel.countDocuments({ stripeEventId: eventId }).exec(),
        ).resolves.toBe(1);
      },
      SLOW_MS,
    );

    // Even two different event ids cannot confirm twice: the conditional
    // status update is the second guard.
    it(
      'confirms once even for two different success events',
      async () => {
        const payment = await openPayment();
        setIntentStatus(payment.intentId, 'succeeded');

        await deliverWebhook(
          'payment_intent.succeeded',
          payment.intentId,
        ).expect(200);
        await deliverWebhook(
          'payment_intent.succeeded',
          payment.intentId,
        ).expect(200);

        expect(confirmCalls).toEqual([bookingId]);
      },
      SLOW_MS,
    );

    it(
      'records a failed attempt and keeps the hold for a retry',
      async () => {
        const payment = await openPayment();

        await deliverWebhook(
          'payment_intent.payment_failed',
          payment.intentId,
          { lastError: 'Your card was declined.' },
        ).expect(200);

        const stored = await paymentModel.findById(payment.id).exec();
        expect(stored?.status).toBe(PaymentStatus.FAILED);
        expect(stored?.failureMessage).toBe('Your card was declined.');
        // PAY-01 lets the user retry while the hold lasts.
        expect(releaseCalls).toEqual([]);
        expect(confirmCalls).toEqual([]);
      },
      SLOW_MS,
    );

    it(
      'releases the hold when Stripe cancels the PaymentIntent',
      async () => {
        const payment = await openPayment();
        setIntentStatus(payment.intentId, 'canceled');

        await deliverWebhook(
          'payment_intent.canceled',
          payment.intentId,
        ).expect(200);

        expect(releaseCalls).toEqual([bookingId]);
        const stored = await paymentModel.findById(payment.id).exec();
        expect(stored?.status).toBe(PaymentStatus.CANCELLED);
      },
      SLOW_MS,
    );

    it(
      'ignores an event type it does not act on',
      async () => {
        const payment = await openPayment();

        const res = await deliverWebhook(
          'payment_intent.created',
          payment.intentId,
        ).expect(200);

        expect(res.body.status).toBe('IGNORED');
        expect(confirmCalls).toEqual([]);
      },
      SLOW_MS,
    );
  });

  describe('Swagger document (Milestone 1 is graded through Swagger UI)', () => {
    let paths: Record<string, Record<string, { summary?: string }>>;

    beforeAll(() => {
      const config = new DocumentBuilder()
        .setTitle('Travel Platform API')
        .addCookieAuth('access_token')
        .build();
      paths = SwaggerModule.createDocument(app, config).paths as never;
    });

    it.each([
      ['post', '/api/payments'],
      ['post', '/api/payments/{id}/retry'],
      ['get', '/api/payments/{id}'],
      ['get', '/api/bookings/{type}/{id}/policies'],
      ['post', '/api/bookings/{type}/{id}/accept-policies'],
    ])('documents %s %s with a summary', (method, path) => {
      expect(paths[path]?.[method]?.summary).toBeTruthy();
    });

    // The webhook is left out on purpose: a request without Stripe's
    // signature is refused, so a "Try it out" button could only ever fail.
    it('leaves the webhook out, because it cannot be driven from a browser', () => {
      expect(paths['/api/payments/webhook']).toBeUndefined();
    });
  });

  describe('POST /api/payments/:id/retry', () => {
    // A declined card does not finish a PaymentIntent: Stripe puts it back to
    // requires_payment_method, so the retry reuses the same intent and client
    // secret with another card rather than opening a second one.
    it(
      'reuses the same PaymentIntent after a declined card',
      async () => {
        await acceptPolicies().expect(200);
        const first = await startPayment().expect(201);
        await deliverWebhook(
          'payment_intent.payment_failed',
          first.body.stripePaymentIntentId,
          { lastError: 'Your card was declined.' },
        ).expect(200);

        const res = await request(app.getHttpServer())
          .post(`/api/payments/${first.body.id}/retry`)
          .set('Cookie', owner.cookie)
          .expect(200);

        expect(res.body.id).toBe(first.body.id);
        expect(res.body.clientSecret).toMatch(/_secret_test$/);
        expect(createdIntents).toHaveLength(1);
      },
      SLOW_MS,
    );

    // A cancelled intent cannot be reused, so a fresh attempt is opened with
    // a new idempotency key.
    it(
      'opens a new attempt when the old intent was cancelled',
      async () => {
        await acceptPolicies().expect(200);
        const first = await startPayment().expect(201);
        setIntentStatus(first.body.stripePaymentIntentId, 'canceled');
        await deliverWebhook(
          'payment_intent.canceled',
          first.body.stripePaymentIntentId,
        ).expect(200);
        // A cancelled intent stays cancelled at Stripe; the hold is still live,
        // so a fresh attempt is allowed.

        const res = await request(app.getHttpServer())
          .post(`/api/payments/${first.body.id}/retry`)
          .set('Cookie', owner.cookie)
          .expect(200);

        expect(res.body.id).not.toBe(first.body.id);
        expect(res.body.attempt).toBe(2);
        expect(createdIntents[1].idempotencyKey).toBe(
          `pay:HOTEL:${bookingId}:2`,
        );
      },
      SLOW_MS,
    );

    it(
      'refuses to retry once the hold has expired (409)',
      async () => {
        await acceptPolicies().expect(200);
        const first = await startPayment().expect(201);
        await deliverWebhook(
          'payment_intent.payment_failed',
          first.body.stripePaymentIntentId,
        ).expect(200);
        holdExpiresAt = new Date(Date.now() - 1000);

        const res = await request(app.getHttpServer())
          .post(`/api/payments/${first.body.id}/retry`)
          .set('Cookie', owner.cookie)
          .expect(409);

        expect(res.body.code).toBe('HOLD_EXPIRED');
      },
      SLOW_MS,
    );

    it(
      'refuses to retry a payment that succeeded (409)',
      async () => {
        await acceptPolicies().expect(200);
        const first = await startPayment().expect(201);
        setIntentStatus(first.body.stripePaymentIntentId, 'succeeded');
        await deliverWebhook(
          'payment_intent.succeeded',
          first.body.stripePaymentIntentId,
        ).expect(200);

        const res = await request(app.getHttpServer())
          .post(`/api/payments/${first.body.id}/retry`)
          .set('Cookie', owner.cookie)
          .expect(409);

        expect(res.body.code).toBe('ALREADY_PAID');
      },
      SLOW_MS,
    );

    it(
      'answers 404 for another account’s payment',
      async () => {
        await acceptPolicies().expect(200);
        const first = await startPayment().expect(201);

        await request(app.getHttpServer())
          .post(`/api/payments/${first.body.id}/retry`)
          .set('Cookie', other.cookie)
          .expect(404);
      },
      SLOW_MS,
    );
  });

  describe('GET /api/payments/:id', () => {
    it(
      'returns the payment with a string amount',
      async () => {
        await acceptPolicies().expect(200);
        const created = await startPayment().expect(201);

        const res = await request(app.getHttpServer())
          .get(`/api/payments/${created.body.id}`)
          .set('Cookie', owner.cookie)
          .expect(200);

        expect(res.body.amount).toBe('420.00');
        expect(res.body).not.toHaveProperty('clientSecret');
      },
      SLOW_MS,
    );

    // A lost or late webhook must not leave the user looking at a wrong status.
    it(
      'picks up a status change Stripe knows about but no webhook reported',
      async () => {
        await acceptPolicies().expect(200);
        const created = await startPayment().expect(201);
        setIntentStatus(created.body.stripePaymentIntentId, 'succeeded');

        const res = await request(app.getHttpServer())
          .get(`/api/payments/${created.body.id}`)
          .set('Cookie', owner.cookie)
          .expect(200);

        expect(res.body.status).toBe(PaymentStatus.SUCCEEDED);
      },
      SLOW_MS,
    );

    it.each(['6720f1c2a1b2c3d4e5f60999', 'not-an-id'])(
      'answers 404 for %s',
      async (id) => {
        await request(app.getHttpServer())
          .get(`/api/payments/${id}`)
          .set('Cookie', owner.cookie)
          .expect(404);
      },
    );

    it(
      'answers 404 for another account’s payment',
      async () => {
        await acceptPolicies().expect(200);
        const created = await startPayment().expect(201);

        await request(app.getHttpServer())
          .get(`/api/payments/${created.body.id}`)
          .set('Cookie', other.cookie)
          .expect(404);
      },
      SLOW_MS,
    );
  });

  describe('hold expiry sweep (PAY-01, GEN-11)', () => {
    it(
      'cancels the PaymentIntent and releases the hold',
      async () => {
        await acceptPolicies().expect(200);
        const created = await startPayment().expect(201);
        holdExpiresAt = new Date(Date.now() - 1000);

        const result = await app.get(PaymentExpiryService).sweep();

        expect(result.cancelled).toBeGreaterThanOrEqual(1);
        expect(cancelledIntents).toContain(created.body.stripePaymentIntentId);
        expect(releaseCalls).toContain(bookingId);

        const stored = await paymentModel.findById(created.body.id).exec();
        expect(stored?.status).toBe(PaymentStatus.CANCELLED);
        expect(stored?.cancelledAt).toBeInstanceOf(Date);
      },
      SLOW_MS,
    );

    it(
      'leaves a live hold alone',
      async () => {
        await acceptPolicies().expect(200);
        const created = await startPayment().expect(201);

        await app.get(PaymentExpiryService).sweep();

        expect(cancelledIntents).not.toContain(
          created.body.stripePaymentIntentId,
        );
        const stored = await paymentModel.findById(created.body.id).exec();
        expect(stored?.status).toBe(PaymentStatus.REQUIRES_PAYMENT_METHOD);
      },
      SLOW_MS,
    );
  });
});
