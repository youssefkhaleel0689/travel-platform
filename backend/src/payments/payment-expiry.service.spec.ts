import { Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus, BookingType } from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { HoldReleaseReason } from '../common/bookings/bookings.port';
import { PaymentExpiryService } from './payment-expiry.service';
import { PaymentStatus } from './payment-status.enum';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

describe('PaymentExpiryService (PAY-01, GEN-11)', () => {
  const BOOKING_ID = '6720f1c2a1b2c3d4e5f60718';
  const PAYMENT_ID = '6720f1c2a1b2c3d4e5f60910';

  let payments: {
    findOpenPayments: jest.Mock;
    applyStatus: jest.Mock;
  };
  let stripe: { cancelPaymentIntent: jest.Mock; isConfigured: boolean };
  let bookings: { getPayableOrThrow: jest.Mock; releaseHold: jest.Mock };
  let service: PaymentExpiryService;
  let loggedError: jest.SpyInstance;

  function paymentDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(PAYMENT_ID),
      bookingType: BookingType.HOTEL,
      bookingId: new Types.ObjectId(BOOKING_ID),
      stripePaymentIntentId: 'pi_1',
      status: PaymentStatus.REQUIRES_PAYMENT_METHOD,
      ...overrides,
    };
  }

  function booking(overrides: Record<string, unknown> = {}) {
    return {
      bookingId: BOOKING_ID,
      bookingType: BookingType.HOTEL,
      userId: '6720f1c2a1b2c3d4e5f60001',
      status: BookingStatus.PENDING_PAYMENT,
      totalAmount: '420.00',
      currency: 'USD',
      // Expired by default: this service only acts on holds that are gone.
      holdExpiresAt: new Date(Date.now() - 60_000),
      bookingReference: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    payments = {
      findOpenPayments: jest.fn().mockResolvedValue([paymentDoc()]),
      applyStatus: jest
        .fn()
        .mockResolvedValue(paymentDoc({ status: PaymentStatus.CANCELLED })),
    };
    stripe = {
      cancelPaymentIntent: jest.fn().mockResolvedValue({ id: 'pi_1' }),
      isConfigured: true,
    };
    bookings = {
      getPayableOrThrow: jest.fn().mockResolvedValue(booking()),
      releaseHold: jest.fn().mockResolvedValue(undefined),
    };

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    loggedError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = new PaymentExpiryService(
      payments as unknown as PaymentsService,
      stripe as unknown as StripeService,
      bookings as unknown as BookingsGateway,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sweep', () => {
    // PAY-01: "when the hold expires the PaymentIntent is cancelled".
    // Cancelling at Stripe is what makes a late payment impossible rather
    // than merely ignored.
    it('cancels the PaymentIntent and releases the hold', async () => {
      const result = await service.sweep();

      expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_1');
      expect(payments.applyStatus).toHaveBeenCalledWith(
        new Types.ObjectId(PAYMENT_ID),
        PaymentStatus.REQUIRES_PAYMENT_METHOD,
        PaymentStatus.CANCELLED,
      );
      expect(bookings.releaseHold).toHaveBeenCalledWith(
        BookingType.HOTEL,
        BOOKING_ID,
        HoldReleaseReason.HOLD_EXPIRED,
      );
      expect(result).toEqual({ checked: 1, cancelled: 1 });
    });

    it('cancels at Stripe before writing the status', async () => {
      const order: string[] = [];
      stripe.cancelPaymentIntent.mockImplementation(() => {
        order.push('stripe');
        return Promise.resolve({ id: 'pi_1' });
      });
      payments.applyStatus.mockImplementation(() => {
        order.push('db');
        return Promise.resolve(paymentDoc());
      });

      await service.sweep();

      // If the order were reversed, a crash in between would leave a cancelled
      // payment in the database that Stripe could still charge.
      expect(order).toEqual(['stripe', 'db']);
    });

    it('leaves a hold that has not expired alone', async () => {
      bookings.getPayableOrThrow.mockResolvedValue(
        booking({ holdExpiresAt: new Date(Date.now() + 5 * 60_000) }),
      );

      const result = await service.sweep();

      expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
      expect(bookings.releaseHold).not.toHaveBeenCalled();
      expect(result).toEqual({ checked: 1, cancelled: 0 });
    });

    // A booking that got CONFIRMED has its own succeeded payment; this open
    // row is a stale earlier attempt, so cancel it at Stripe but do not give
    // back the inventory the confirmed booking now owns.
    it('cancels a stale attempt on a confirmed booking without releasing it', async () => {
      bookings.getPayableOrThrow.mockResolvedValue(
        booking({
          status: BookingStatus.CONFIRMED,
          holdExpiresAt: null,
          bookingReference: 'NILE-4821',
        }),
      );

      const result = await service.sweep();

      expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_1');
      expect(bookings.releaseHold).not.toHaveBeenCalled();
      expect(result.cancelled).toBe(1);
    });

    it.each([
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
      BookingStatus.COMPLETED,
    ])('cancels the attempt on a %s booking', async (status) => {
      bookings.getPayableOrThrow.mockResolvedValue(
        booking({ status, holdExpiresAt: null }),
      );

      await service.sweep();

      expect(stripe.cancelPaymentIntent).toHaveBeenCalled();
      expect(bookings.releaseHold).not.toHaveBeenCalled();
    });

    // The webhook and the sweep can both arrive; whichever claims the status
    // change does the release, and the other does nothing.
    it('does not release when a webhook already claimed the status', async () => {
      payments.applyStatus.mockResolvedValue(null);

      const result = await service.sweep();

      expect(bookings.releaseHold).not.toHaveBeenCalled();
      expect(result.cancelled).toBe(0);
    });

    it('carries on past one payment that throws', async () => {
      payments.findOpenPayments.mockResolvedValue([
        paymentDoc({ _id: new Types.ObjectId() }),
        paymentDoc(),
      ]);
      bookings.getPayableOrThrow
        .mockRejectedValueOnce(new NotFoundException('Booking not found'))
        .mockResolvedValue(booking());

      const result = await service.sweep();

      expect(result).toEqual({ checked: 2, cancelled: 1 });
      expect(stripe.cancelPaymentIntent).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there is nothing open', async () => {
      payments.findOpenPayments.mockResolvedValue([]);

      await expect(service.sweep()).resolves.toEqual({
        checked: 0,
        cancelled: 0,
      });
    });
  });

  describe('scheduledSweep', () => {
    it('does not run without a Stripe key', async () => {
      stripe.isConfigured = false;

      await service.scheduledSweep();

      expect(payments.findOpenPayments).not.toHaveBeenCalled();
    });

    // A slow Stripe call must not let two sweeps work on the same payment.
    it('skips a run while the previous one is still going', async () => {
      let release: () => void = () => undefined;
      payments.findOpenPayments.mockImplementation(
        () => new Promise((resolve) => {
          release = () => resolve([]);
        }),
      );

      const first = service.scheduledSweep();
      await service.scheduledSweep();

      expect(payments.findOpenPayments).toHaveBeenCalledTimes(1);
      release();
      await first;

      // Once it has finished, the next run is allowed again.
      payments.findOpenPayments.mockResolvedValue([]);
      await service.scheduledSweep();
      expect(payments.findOpenPayments).toHaveBeenCalledTimes(2);
    });

    it('swallows a failure so the schedule keeps running', async () => {
      payments.findOpenPayments.mockRejectedValue(new Error('database down'));

      await expect(service.scheduledSweep()).resolves.toBeUndefined();
      expect(loggedError).toHaveBeenCalled();

      // And the lock was released, so the next tick still runs.
      payments.findOpenPayments.mockResolvedValue([]);
      await service.scheduledSweep();
      expect(payments.findOpenPayments).toHaveBeenCalledTimes(2);
    });
  });
});
