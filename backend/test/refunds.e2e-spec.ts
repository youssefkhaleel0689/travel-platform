// PAY-03 end to end against the shared database.
//
// The whole path is driven for real: pay for a booking, confirm it with a
// genuinely Stripe-signed webhook, then have the flights or hotels module's
// cancellation call RefundsService, and read the refund back over HTTP.
// Only Stripe's HTTP API and the BookingsPort are stood in for.
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
import { CancelledBy, RefundStatus } from './../src/payments/refund-status.enum';
import { RefundsService } from './../src/payments/refunds.service';
import { Payment } from './../src/payments/schemas/payment.schema';
import { PolicyAcceptance } from './../src/payments/schemas/policy-acceptance.schema';
import { Refund } from './../src/payments/schemas/refund.schema';
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
const CANCELLATION_TIERS = {
  cancellationTiers: [
    { daysBeforeCheckIn: 7, refundPercentage: 100 },
    { daysBeforeCheckIn: 2, refundPercentage: 50 },
  ],
};

describe('Refunds (e2e)', () => {
  let app: INestApplication<App>;
  let refunds: RefundsService;
  let paymentModel: Model<Payment>;
  let refundModel: Model<Refund>;
  let acceptanceModel: Model<PolicyAcceptance>;
  let eventModel: Model<StripeWebhookEvent>;
  let stripeSigner: Stripe;

  const createdUserIds: string[] = [];
  let owner: SignedInUser;
  let other: SignedInUser;

  let bookingId: string;
  let bookingStatus: BookingStatus;
  let intentStatuses: Record<string, string>;
  let refundOutcome: { id: string; status: string } | Error;
  let refundRequests: { amount: string; idempotencyKey: string }[];
  let intentCounter = 0;

  function standIns(): void {
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
        totalAmount: '420.00',
        currency: 'USD',
        holdExpiresAt:
          bookingStatus === BookingStatus.PENDING_PAYMENT
            ? new Date(Date.now() + 10 * 60 * 1000)
            : null,
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
        policySnapshot: CANCELLATION_TIERS,
      }),
    );
    jest.spyOn(gateway, 'confirmAfterPayment').mockImplementation((type, id) => {
      bookingStatus = BookingStatus.CONFIRMED;
      return Promise.resolve({
        bookingId: id,
        status: BookingStatus.CONFIRMED,
        bookingReference: 'NILE-4821',
      });
    });
    jest.spyOn(gateway, 'releaseHold').mockResolvedValue(undefined);

    const stripe = app.get(StripeService);
    jest.spyOn(stripe, 'createPaymentIntent').mockImplementation(() => {
      intentCounter += 1;
      const id = `pi_ref_${Date.now()}_${intentCounter}`;
      intentStatuses[id] = 'requires_payment_method';
      return Promise.resolve({
        id,
        status: 'requires_payment_method',
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
    jest.spyOn(stripe, 'cancelPaymentIntent').mockResolvedValue(null);
    jest.spyOn(stripe, 'createRefund').mockImplementation((input) => {
      refundRequests.push({
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
      });
      if (refundOutcome instanceof Error) {
        return Promise.reject(refundOutcome);
      }
      return Promise.resolve(refundOutcome as never);
    });
  }

  function deliverWebhook(type: string, paymentIntentId: string) {
    const body = JSON.stringify({
      id: `evt_ref_${Date.now()}_${Math.random()}`,
      object: 'event',
      type,
      data: {
        object: {
          id: paymentIntentId,
          object: 'payment_intent',
          metadata: { bookingId, bookingType: BookingType.HOTEL },
        },
      },
    });
    return request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set(
        'stripe-signature',
        stripeSigner.webhooks.generateTestHeaderString({
          payload: body,
          secret: webhookSecret(),
        }),
      )
      .set('Content-Type', 'application/json')
      .send(body);
  }

  /** Pays for the booking and confirms it, as a real user would. */
  async function payAndConfirm(): Promise<string> {
    await request(app.getHttpServer())
      .post(`/api/bookings/hotel/${bookingId}/accept-policies`)
      .set('Cookie', owner.cookie)
      .send({ accepted: true, policyVersion: 1 })
      .expect(200);
    const payment = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Cookie', owner.cookie)
      .send({ bookingType: BookingType.HOTEL, bookingId })
      .expect(201);

    intentStatuses[payment.body.stripePaymentIntentId] = 'succeeded';
    await deliverWebhook(
      'payment_intent.succeeded',
      payment.body.stripePaymentIntentId,
    ).expect(200);
    return payment.body.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();

    refunds = app.get(RefundsService);
    paymentModel = app.get<Model<Payment>>(getModelToken(Payment.name));
    refundModel = app.get<Model<Refund>>(getModelToken(Refund.name));
    acceptanceModel = app.get<Model<PolicyAcceptance>>(
      getModelToken(PolicyAcceptance.name),
    );
    eventModel = app.get<Model<StripeWebhookEvent>>(
      getModelToken(StripeWebhookEvent.name),
    );
    stripeSigner = new Stripe('sk_test_placeholder');

    owner = await createSignedInUser(app, { label: 'refund-owner' });
    other = await createSignedInUser(app, { label: 'refund-other' });
    createdUserIds.push(owner.userId, other.userId);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    const userIds = createdUserIds.map((id) => new Types.ObjectId(id));
    const payments = await paymentModel
      .find({ userId: { $in: userIds } })
      .select('_id')
      .lean()
      .exec();
    await refundModel
      .deleteMany({ paymentId: { $in: payments.map((p) => p._id) } })
      .exec();
    await paymentModel.deleteMany({ userId: { $in: userIds } }).exec();
    await acceptanceModel.deleteMany({ userId: { $in: userIds } }).exec();
    await eventModel.deleteMany({ stripeEventId: /^evt_ref_/ }).exec();
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  beforeEach(() => {
    bookingId = new Types.ObjectId().toString();
    bookingStatus = BookingStatus.PENDING_PAYMENT;
    intentStatuses = {};
    refundOutcome = { id: `re_${Date.now()}`, status: 'succeeded' };
    refundRequests = [];
    standIns();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a user cancellation refunds the tier share', () => {
    it('refunds 50% of what was captured and records it', async () => {
      const paymentId = await payAndConfirm();

      // What HTL-21 does when the traveller cancels within the 50% tier.
      const refund = await refunds.issueForCancellation({
        bookingType: BookingType.HOTEL,
        bookingId,
        cancelledBy: CancelledBy.USER,
        refundPercentage: 50,
        reason: 'Cancelled by the traveller 3 days before check-in',
        policySnapshot: CANCELLATION_TIERS,
      });

      expect(refund).not.toBeNull();
      expect(refundRequests[0].amount).toBe('210.00');

      const res = await request(app.getHttpServer())
        .get(`/api/refunds/${refund!._id.toString()}`)
        .set('Cookie', owner.cookie)
        .expect(200);

      expect(res.body).toMatchObject({
        bookingType: BookingType.HOTEL,
        bookingId,
        paymentId,
        amount: '210.00',
        currency: 'USD',
        status: RefundStatus.REFUNDED,
        cancelledBy: CancelledBy.USER,
        refundPercentage: 50,
        policySnapshot: CANCELLATION_TIERS,
      });
      expect(res.body.stripeRefundId).toMatch(/^re_/);
      expect(res.body.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }, SLOW_MS);

    it('tells the user about it (GEN-01)', async () => {
      await payAndConfirm();
      await refunds.issueForCancellation({
        bookingType: BookingType.HOTEL,
        bookingId,
        cancelledBy: CancelledBy.USER,
        refundPercentage: 50,
        reason: 'Cancelled by the traveller',
      });

      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Cookie', owner.cookie)
        .expect(200);

      const refundNotice = res.body.items.find(
        (item: { type: string }) => item.type === 'REFUND_ISSUED',
      );
      expect(refundNotice).toBeDefined();
      expect(refundNotice.message).toContain('210.00 USD');
    }, SLOW_MS);
  });

  // PAY-03: a provider-initiated cancellation is always a full refund.
  it('refunds a provider cancellation in full, whatever the tier says', async () => {
    await payAndConfirm();

    const refund = await refunds.issueForCancellation({
      bookingType: BookingType.HOTEL,
      bookingId,
      cancelledBy: CancelledBy.PROVIDER,
      refundPercentage: 25,
      reason: 'The hotel cancelled the reservation',
      policySnapshot: CANCELLATION_TIERS,
    });

    expect(refundRequests[0].amount).toBe('420.00');
    expect(refund?.refundPercentage).toBe(100);
  }, SLOW_MS);

  it('issues nothing when the tier gives 0%', async () => {
    await payAndConfirm();

    await expect(
      refunds.issueForCancellation({
        bookingType: BookingType.HOTEL,
        bookingId,
        cancelledBy: CancelledBy.USER,
        refundPercentage: 0,
        reason: 'Cancelled too late for a refund',
      }),
    ).resolves.toBeNull();

    expect(refundRequests).toEqual([]);
    await expect(
      refundModel
        .countDocuments({ bookingId: new Types.ObjectId(bookingId) })
        .exec(),
    ).resolves.toBe(0);
  }, SLOW_MS);

  it('issues nothing for a booking that was never paid', async () => {
    await expect(
      refunds.issueForCancellation({
        bookingType: BookingType.HOTEL,
        bookingId,
        cancelledBy: CancelledBy.PROVIDER,
        refundPercentage: 100,
        reason: 'The hotel cancelled an unpaid hold',
      }),
    ).resolves.toBeNull();
    expect(refundRequests).toEqual([]);
  }, SLOW_MS);

  it('refuses to refund the same booking twice', async () => {
    await payAndConfirm();
    const first = {
      bookingType: BookingType.HOTEL,
      bookingId,
      cancelledBy: CancelledBy.USER,
      refundPercentage: 50,
      reason: 'Cancelled by the traveller',
    };
    await refunds.issueForCancellation(first);

    await expect(refunds.issueForCancellation(first)).rejects.toMatchObject({
      response: { code: 'REFUND_ALREADY_ISSUED' },
    });
    expect(refundRequests).toHaveLength(1);
  }, SLOW_MS);

  describe('when Stripe refuses the refund', () => {
    // The cancellation has already happened, so the refund has to be visible
    // as FAILED rather than disappearing behind an error.
    it('records it as FAILED and still shows it on the booking', async () => {
      await payAndConfirm();
      refundOutcome = new Error('Stripe is unavailable');

      const refund = await refunds.issueForCancellation({
        bookingType: BookingType.HOTEL,
        bookingId,
        cancelledBy: CancelledBy.USER,
        refundPercentage: 50,
        reason: 'Cancelled by the traveller',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/refunds/${refund!._id.toString()}`)
        .set('Cookie', owner.cookie)
        .expect(200);

      expect(res.body.status).toBe(RefundStatus.FAILED);
      expect(res.body.failureMessage).toContain('Stripe is unavailable');
      expect(res.body.stripeRefundId).toBeNull();
      expect(res.body.completedAt).toBeNull();
    }, SLOW_MS);

    it('can be retried, with a new idempotency key', async () => {
      await payAndConfirm();
      refundOutcome = new Error('Stripe is unavailable');
      await refunds.issueForCancellation({
        bookingType: BookingType.HOTEL,
        bookingId,
        cancelledBy: CancelledBy.USER,
        refundPercentage: 50,
        reason: 'Cancelled by the traveller',
      });

      // A fresh attempt after the failure, allowed because the first failed.
      refundOutcome = { id: `re_retry_${Date.now()}`, status: 'succeeded' };
      const retried = await refunds.issueForCancellation({
        bookingType: BookingType.HOTEL,
        bookingId,
        cancelledBy: CancelledBy.USER,
        refundPercentage: 50,
        reason: 'Cancelled by the traveller',
      });

      expect(retried?.status).toBe(RefundStatus.REFUNDED);
      expect(refundRequests[1].idempotencyKey).toBe(
        `refund:HOTEL:${bookingId}:2`,
      );
      // The amount never changes between attempts.
      expect(refundRequests[1].amount).toBe('210.00');
    }, SLOW_MS);
  });

  describe('GET /api/refunds/:id', () => {
    it('answers 404 for another account’s refund (ACC-11)', async () => {
      await payAndConfirm();
      const refund = await refunds.issueForCancellation({
        bookingType: BookingType.HOTEL,
        bookingId,
        cancelledBy: CancelledBy.USER,
        refundPercentage: 50,
        reason: 'Cancelled by the traveller',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/refunds/${refund!._id.toString()}`)
        .set('Cookie', other.cookie)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    }, SLOW_MS);

    it.each(['6720f1c2a1b2c3d4e5f60999', 'not-an-id'])(
      'answers 404 for %s',
      async (id) => {
        await request(app.getHttpServer())
          .get(`/api/refunds/${id}`)
          .set('Cookie', owner.cookie)
          .expect(404);
      },
    );

    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer())
        .get('/api/refunds/6720f1c2a1b2c3d4e5f60920')
        .expect(401);
    });

    it('is in the Swagger document with a summary', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Travel Platform API').build(),
      );
      const paths = document.paths as Record<
        string,
        Record<string, { summary?: string }>
      >;

      expect(paths['/api/refunds/{id}']?.get?.summary).toContain('PAY-03');
      // There is deliberately no endpoint to create a refund: one only ever
      // follows a cancellation.
      expect(paths['/api/refunds']).toBeUndefined();
    });
  });
});
