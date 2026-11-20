import { Logger } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { BookingType } from '../common/bookings/booking-status';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentStatus } from './payment-status.enum';
import { PaymentsService } from './payments.service';
import { CancelledBy, RefundKind, RefundStatus } from './refund-status.enum';
import { RefundsService } from './refunds.service';
import { PaymentDocument } from './schemas/payment.schema';
import { Refund } from './schemas/refund.schema';
import { StripeService } from './stripe.service';

// PAY-01: the refund the platform makes on its own, for a payment whose
// booking could not take it (the money arrived after the hold, the booking was
// already confirmed by another payment, or it is gone).
describe('RefundsService.refundUnconfirmablePayment (PAY-01)', () => {
  const USER_ID = '6720f1c2a1b2c3d4e5f60001';
  const BOOKING_ID = '6720f1c2a1b2c3d4e5f60718';
  const PAYMENT_ID = '6720f1c2a1b2c3d4e5f60910';
  const REFUND_ID = '6720f1c2a1b2c3d4e5f60920';
  const KEY = `refund:unconfirmed:${PAYMENT_ID}`;

  let model: {
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let stripe: { createRefund: jest.Mock; retrieveRefund: jest.Mock };
  let payments: { findById: jest.Mock };
  let notifications: { notify: jest.Mock };
  let service: RefundsService;

  const exec = (value: unknown) => ({
    exec: jest.fn().mockResolvedValue(value),
  });
  const sortExec = (value: unknown) => ({
    sort: jest.fn().mockReturnValue(exec(value)),
  });

  function payment(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(PAYMENT_ID),
      bookingType: BookingType.FLIGHT,
      bookingId: new Types.ObjectId(BOOKING_ID),
      userId: new Types.ObjectId(USER_ID),
      stripePaymentIntentId: 'pi_1',
      amount: Types.Decimal128.fromString('150.00'),
      currency: 'USD',
      status: PaymentStatus.SUCCEEDED,
      ...overrides,
    } as unknown as PaymentDocument;
  }

  function refund(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(REFUND_ID),
      bookingType: BookingType.FLIGHT,
      bookingId: new Types.ObjectId(BOOKING_ID),
      paymentId: new Types.ObjectId(PAYMENT_ID),
      stripeRefundId: null,
      amount: Types.Decimal128.fromString('150.00'),
      currency: 'USD',
      status: RefundStatus.PENDING,
      cancelledBy: CancelledBy.SYSTEM,
      reason: 'late',
      refundPercentage: 100,
      idempotencyKey: KEY,
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
          Promise.resolve(refund(doc as Record<string, unknown>)),
        ),
      find: jest.fn().mockReturnValue(sortExec([])),
      findOne: jest.fn().mockReturnValue(exec(null)),
      findById: jest.fn().mockReturnValue(exec(refund())),
      findOneAndUpdate: jest.fn().mockReturnValue(exec(null)),
    };
    stripe = {
      createRefund: jest
        .fn()
        .mockResolvedValue({ id: 're_1', status: 'succeeded' }),
      retrieveRefund: jest.fn().mockResolvedValue({
        id: 're_1',
        status: 'succeeded',
        failure_reason: null,
      }),
    };
    payments = { findById: jest.fn().mockResolvedValue(payment()) };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
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

  describe('refundUnconfirmablePayment', () => {
    it('refunds the whole payment, recorded as the platform at 100%', async () => {
      const result = await service.refundUnconfirmablePayment(
        payment(),
        'arrived late',
      );

      expect(result.created).toBe(true);
      const [row] = model.create.mock.calls[0] as [Record<string, unknown>];
      expect(row.paymentId).toEqual(new Types.ObjectId(PAYMENT_ID));
      expect(String(row.amount)).toBe('150.00');
      expect(row.cancelledBy).toBe(CancelledBy.SYSTEM);
      expect(row.refundPercentage).toBe(100);
      expect(row.reason).toBe('arrived late');
      expect(row.idempotencyKey).toBe(KEY);
      // Its own kind, so it never blocks the booking's cancellation refund.
      expect(row.kind).toBe(RefundKind.UNCONFIRMED_PAYMENT);
      expect(stripe.createRefund).toHaveBeenCalledWith({
        stripePaymentIntentId: 'pi_1',
        amount: '150.00',
        idempotencyKey: KEY,
        bookingId: BOOKING_ID,
      });
    });

    it('tells the user the payment could not be applied, not that a booking was cancelled', async () => {
      await service.refundUnconfirmablePayment(payment(), 'arrived late');

      const [notice] = notifications.notify.mock.calls[0] as [
        { message: string },
      ];
      expect(notice.message).toMatch(/could not be applied/);
      expect(notice.message).not.toMatch(/cancelled/);
    });

    // A webhook retry and the sweep can both arrive here for one payment.
    it('does nothing when the payment already has a live refund', async () => {
      const live = refund({ status: RefundStatus.REFUNDED });
      model.find.mockReturnValue(sortExec([live]));

      const result = await service.refundUnconfirmablePayment(
        payment(),
        'late',
      );

      expect(result).toEqual({ refund: live, created: false });
      expect(model.create).not.toHaveBeenCalled();
      expect(stripe.createRefund).not.toHaveBeenCalled();
    });

    it('resends its own failed refund instead of making a second one', async () => {
      const failed = refund({ status: RefundStatus.FAILED });
      model.find.mockReturnValue(sortExec([failed]));

      await service.refundUnconfirmablePayment(payment(), 'late');

      expect(model.create).not.toHaveBeenCalled();
      expect(stripe.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: KEY }),
      );
    });

    it('returns the row another caller created a moment earlier', async () => {
      const winner = refund();
      model.create.mockRejectedValue(
        Object.assign(new Error('E11000'), { code: 11000 }),
      );
      model.findOne.mockReturnValue(exec(winner));

      const result = await service.refundUnconfirmablePayment(
        payment(),
        'late',
      );

      expect(result).toEqual({ refund: winner, created: false });
      expect(stripe.createRefund).not.toHaveBeenCalled();
    });

    it('records a Stripe refusal as FAILED rather than throwing', async () => {
      stripe.createRefund.mockRejectedValue(new Error('Stripe is down'));

      const result = await service.refundUnconfirmablePayment(
        payment(),
        'late',
      );

      expect(result.refund.status).toBe(RefundStatus.FAILED);
      expect(result.refund.failureMessage).toBe('Stripe is down');
    });
  });
});
