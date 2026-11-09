import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { BookingType } from '../common/bookings/booking-status';
import { NotificationType } from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentStatus } from './payment-status.enum';
import { PaymentsService } from './payments.service';
import { CancelledBy, RefundStatus } from './refund-status.enum';
import { RefundsService } from './refunds.service';
import { Refund } from './schemas/refund.schema';
import { StripeService } from './stripe.service';

describe('RefundsService (PAY-03)', () => {
  const USER_ID = '6720f1c2a1b2c3d4e5f60001';
  const OTHER_USER_ID = '6720f1c2a1b2c3d4e5f60002';
  const BOOKING_ID = '6720f1c2a1b2c3d4e5f60718';
  const PAYMENT_ID = '6720f1c2a1b2c3d4e5f60910';
  const REFUND_ID = '6720f1c2a1b2c3d4e5f60920';

  let model: { create: jest.Mock; find: jest.Mock; findById: jest.Mock };
  let stripe: { createRefund: jest.Mock };
  let payments: {
    findSucceededForBooking: jest.Mock;
    findById: jest.Mock;
    findByStripeId: jest.Mock;
  };
  let notifications: { notify: jest.Mock };
  let service: RefundsService;

  const exec = (value: unknown) => ({
    exec: jest.fn().mockResolvedValue(value),
  });
  const sortExec = (value: unknown) => ({
    sort: jest.fn().mockReturnValue(exec(value)),
  });

  function paymentDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(PAYMENT_ID),
      userId: new Types.ObjectId(USER_ID),
      stripePaymentIntentId: 'pi_1',
      amount: Types.Decimal128.fromString('420.00'),
      currency: 'USD',
      status: PaymentStatus.SUCCEEDED,
      ...overrides,
    };
  }

  function refundDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(REFUND_ID),
      bookingType: BookingType.HOTEL,
      bookingId: new Types.ObjectId(BOOKING_ID),
      paymentId: new Types.ObjectId(PAYMENT_ID),
      stripeRefundId: null,
      amount: Types.Decimal128.fromString('210.00'),
      currency: 'USD',
      status: RefundStatus.PENDING,
      cancelledBy: CancelledBy.USER,
      reason: 'Cancelled by the traveller',
      refundPercentage: 50,
      policySnapshot: null,
      idempotencyKey: `refund:HOTEL:${BOOKING_ID}:1`,
      requestedAt: new Date(),
      completedAt: null,
      failureMessage: null,
      save: jest.fn().mockImplementation(function (this: unknown) {
        return Promise.resolve(this);
      }),
      ...overrides,
    };
  }

  beforeEach(() => {
    model = {
      create: jest
        .fn()
        .mockImplementation((doc) =>
          Promise.resolve(refundDoc(doc as Record<string, unknown>)),
        ),
      find: jest.fn().mockReturnValue(sortExec([])),
      findById: jest.fn().mockReturnValue(exec(refundDoc())),
    };
    stripe = {
      createRefund: jest
        .fn()
        .mockResolvedValue({ id: 're_1', status: 'succeeded' }),
    };
    payments = {
      findSucceededForBooking: jest.fn().mockResolvedValue(paymentDoc()),
      findById: jest.fn().mockResolvedValue(paymentDoc()),
      findByStripeId: jest.fn().mockResolvedValue(paymentDoc()),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    service = new RefundsService(
      model as unknown as Model<Refund>,
      stripe as unknown as StripeService,
      payments as unknown as PaymentsService,
      notifications as unknown as NotificationsService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const userCancellation = {
    bookingType: BookingType.HOTEL,
    bookingId: BOOKING_ID,
    cancelledBy: CancelledBy.USER,
    refundPercentage: 50,
    reason: 'Cancelled by the traveller 5 days before check-in',
  };

  describe('issueForCancellation', () => {
    it('refunds the tier share of what was captured', async () => {
      const refund = await service.issueForCancellation(userCancellation);

      // 50% of 420.00
      expect(stripe.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          stripePaymentIntentId: 'pi_1',
          amount: '210.00',
          idempotencyKey: `refund:HOTEL:${BOOKING_ID}:1`,
        }),
      );
      expect(refund?.status).toBe(RefundStatus.REFUNDED);
      expect(refund?.stripeRefundId).toBe('re_1');
      expect(refund?.completedAt).toBeInstanceOf(Date);
    });

    // PAY-03: a provider-initiated cancellation is always a full refund,
    // whatever the tiers say.
    it('refunds a provider cancellation in full, ignoring the tier', async () => {
      await service.issueForCancellation({
        ...userCancellation,
        cancelledBy: CancelledBy.PROVIDER,
        refundPercentage: 25,
      });

      expect(stripe.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '420.00' }),
      );
      const created = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.refundPercentage).toBe(100);
    });

    it('records the terms the percentage came from', async () => {
      const policySnapshot = {
        cancellationTiers: [{ daysBeforeCheckIn: 7, refundPercentage: 50 }],
      };

      await service.issueForCancellation({
        ...userCancellation,
        policySnapshot,
      });

      const created = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.policySnapshot).toEqual(policySnapshot);
    });

    it('tells the user a refund is on its way (GEN-01)', async () => {
      await service.issueForCancellation(userCancellation);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.REFUND_ISSUED,
          message: expect.stringContaining('210.00 USD'),
        }),
      );
    });

    // PAY-03 applies to a cancellation "with a positive refund amount".
    it('issues nothing for a 0% tier', async () => {
      await expect(
        service.issueForCancellation({
          ...userCancellation,
          refundPercentage: 0,
        }),
      ).resolves.toBeNull();
      expect(model.create).not.toHaveBeenCalled();
      expect(stripe.createRefund).not.toHaveBeenCalled();
    });

    it('issues nothing when the booking was never paid', async () => {
      payments.findSucceededForBooking.mockResolvedValue(null);

      await expect(
        service.issueForCancellation(userCancellation),
      ).resolves.toBeNull();
      expect(stripe.createRefund).not.toHaveBeenCalled();
    });

    // A cancellation that somehow runs twice must not pay out twice.
    it.each([RefundStatus.PENDING, RefundStatus.REFUNDED])(
      'refuses a second refund when one is already %s (409)',
      async (status) => {
        model.find.mockReturnValue(sortExec([refundDoc({ status })]));

        await expect(
          service.issueForCancellation(userCancellation),
        ).rejects.toThrow(ConflictException);
        expect(stripe.createRefund).not.toHaveBeenCalled();
      },
    );

    it('allows a new refund after a failed one, with a fresh key', async () => {
      model.find.mockReturnValue(
        sortExec([refundDoc({ status: RefundStatus.FAILED })]),
      );

      await service.issueForCancellation(userCancellation);

      const created = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.idempotencyKey).toBe(`refund:HOTEL:${BOOKING_ID}:2`);
    });

    // The data model's invariant is that total refunds never exceed what was
    // captured. One refund per booking is the stronger rule that enforces it,
    // so a booking that already has a successful refund is refused before the
    // amounts are even added up.
    it('refuses to pay out again on a booking already refunded', async () => {
      model.find.mockReturnValue(
        sortExec([
          refundDoc({
            status: RefundStatus.REFUNDED,
            amount: Types.Decimal128.fromString('420.00'),
          }),
        ]),
      );

      await expect(
        service.issueForCancellation(userCancellation),
      ).rejects.toMatchObject({
        response: { code: 'REFUND_ALREADY_ISSUED' },
      });
      expect(stripe.createRefund).not.toHaveBeenCalled();
    });

    it('rejects a percentage outside 0 to 100', async () => {
      await expect(
        service.issueForCancellation({
          ...userCancellation,
          refundPercentage: 150,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rounds the share to the cent', async () => {
      payments.findSucceededForBooking.mockResolvedValue(
        paymentDoc({ amount: Types.Decimal128.fromString('99.99') }),
      );

      await service.issueForCancellation({
        ...userCancellation,
        refundPercentage: 25,
      });

      // 99.99 * 25% = 24.9975 -> 25.00
      expect(stripe.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '25.00' }),
      );
    });

    // A failed refund must not look like a failed cancellation: the
    // cancellation has already happened.
    it('records a Stripe failure as FAILED and does not throw', async () => {
      stripe.createRefund.mockRejectedValue(new Error('Stripe is down'));

      const refund = await service.issueForCancellation(userCancellation);

      expect(refund?.status).toBe(RefundStatus.FAILED);
      expect(refund?.failureMessage).toBe('Stripe is down');
      expect(refund?.completedAt).toBeNull();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('writes the row before calling Stripe, so an attempt is never invisible', async () => {
      const order: string[] = [];
      model.create.mockImplementation((doc) => {
        order.push('db');
        return Promise.resolve(refundDoc(doc as Record<string, unknown>));
      });
      stripe.createRefund.mockImplementation(() => {
        order.push('stripe');
        return Promise.resolve({ id: 're_1', status: 'succeeded' });
      });

      await service.issueForCancellation(userCancellation);

      expect(order).toEqual(['db', 'stripe']);
    });

    it.each([
      ['pending', RefundStatus.PENDING],
      ['succeeded', RefundStatus.REFUNDED],
      ['failed', RefundStatus.FAILED],
      ['something_new', RefundStatus.PENDING],
    ])('maps Stripe status %s to %s', async (stripeStatus, expected) => {
      stripe.createRefund.mockResolvedValue({
        id: 're_1',
        status: stripeStatus,
      });

      const refund = await service.issueForCancellation(userCancellation);

      expect(refund?.status).toBe(expected);
    });
  });

  describe('retryFailed', () => {
    it('resends a failed refund with the same amount', async () => {
      model.findById.mockReturnValue(
        exec(refundDoc({ status: RefundStatus.FAILED })),
      );

      const refund = await service.retryFailed(REFUND_ID);

      expect(stripe.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '210.00' }),
      );
      expect(refund.status).toBe(RefundStatus.REFUNDED);
    });

    it.each([RefundStatus.PENDING, RefundStatus.REFUNDED])(
      'refuses to retry a %s refund (409)',
      async (status) => {
        model.findById.mockReturnValue(exec(refundDoc({ status })));

        await expect(service.retryFailed(REFUND_ID)).rejects.toMatchObject({
          response: { code: 'REFUND_NOT_FAILED' },
        });
      },
    );
  });

  describe('findOwnOrThrow (ACC-11)', () => {
    it('returns the refund to the account that paid', async () => {
      const refund = await service.findOwnOrThrow(USER_ID, REFUND_ID);

      expect(refund._id.toString()).toBe(REFUND_ID);
    });

    // The owner is found through the payment, so a refund of someone else's
    // booking is indistinguishable from one that does not exist.
    it('answers 404 for another account', async () => {
      payments.findById.mockResolvedValue(
        paymentDoc({ userId: new Types.ObjectId(OTHER_USER_ID) }),
      );

      await expect(
        service.findOwnOrThrow(USER_ID, REFUND_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 for a missing or malformed id', async () => {
      model.findById.mockReturnValue(exec(null));
      await expect(
        service.findOwnOrThrow(USER_ID, REFUND_ID),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.findOwnOrThrow(USER_ID, 'not-an-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findForBooking', () => {
    it('returns an empty list for a malformed booking id without querying', async () => {
      await expect(
        service.findForBooking(BookingType.HOTEL, 'nope'),
      ).resolves.toEqual([]);
      expect(model.find).not.toHaveBeenCalled();
    });
  });
});
