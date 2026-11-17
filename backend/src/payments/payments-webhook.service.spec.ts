import { Logger, UnauthorizedException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { BookingStatus, BookingType } from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { HoldReleaseReason } from '../common/bookings/bookings.port';
import { NotificationType } from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentStatus } from './payment-status.enum';
import { PaymentsService } from './payments.service';
import { PaymentsWebhookService } from './payments-webhook.service';
import {
  StripeWebhookEvent,
  WebhookEventStatus,
} from './schemas/stripe-webhook-event.schema';
import { StripeService } from './stripe.service';

type Filter = Record<string, unknown>;

describe('PaymentsWebhookService (PAY-01)', () => {
  const USER_ID = '6720f1c2a1b2c3d4e5f60001';
  const BOOKING_ID = '6720f1c2a1b2c3d4e5f60718';
  const PAYMENT_ID = '6720f1c2a1b2c3d4e5f60910';
  const RAW_BODY = Buffer.from('{"id":"evt_1"}');
  const SIGNATURE = 't=1,v1=abc';

  let eventModel: {
    create: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
  };
  let stripe: { constructWebhookEvent: jest.Mock };
  let payments: {
    findByStripeId: jest.Mock;
    applyStatus: jest.Mock;
  };
  let bookings: { confirmAfterPayment: jest.Mock; releaseHold: jest.Mock };
  let notifications: { notify: jest.Mock };
  let service: PaymentsWebhookService;

  const exec = (value: unknown) => ({
    exec: jest.fn().mockResolvedValue(value),
  });

  function paymentDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(PAYMENT_ID),
      bookingType: BookingType.HOTEL,
      bookingId: new Types.ObjectId(BOOKING_ID),
      userId: new Types.ObjectId(USER_ID),
      stripePaymentIntentId: 'pi_1',
      amount: Types.Decimal128.fromString('420.00'),
      currency: 'USD',
      status: PaymentStatus.REQUIRES_PAYMENT_METHOD,
      ...overrides,
    };
  }

  function event(
    type: string,
    intent: Record<string, unknown> = {},
  ): Stripe.Event {
    return {
      id: 'evt_1',
      type,
      data: {
        object: {
          id: 'pi_1',
          object: 'payment_intent',
          metadata: { bookingId: BOOKING_ID },
          ...intent,
        },
      },
    } as unknown as Stripe.Event;
  }

  beforeEach(() => {
    eventModel = {
      create: jest.fn().mockResolvedValue({}),
      findOneAndUpdate: jest.fn().mockReturnValue(exec(null)),
      updateOne: jest.fn().mockReturnValue(exec({ modifiedCount: 1 })),
    };
    stripe = {
      constructWebhookEvent: jest
        .fn()
        .mockReturnValue(event('payment_intent.succeeded')),
    };
    payments = {
      findByStripeId: jest.fn().mockResolvedValue(paymentDoc()),
      applyStatus: jest
        .fn()
        .mockResolvedValue(paymentDoc({ status: PaymentStatus.SUCCEEDED })),
    };
    bookings = {
      confirmAfterPayment: jest.fn().mockResolvedValue({
        bookingId: BOOKING_ID,
        status: BookingStatus.CONFIRMED,
        bookingReference: 'NILE-4821',
      }),
      releaseHold: jest.fn().mockResolvedValue(undefined),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    service = new PaymentsWebhookService(
      eventModel as unknown as Model<StripeWebhookEvent>,
      stripe as unknown as StripeService,
      payments as unknown as PaymentsService,
      bookings as unknown as BookingsGateway,
      notifications as unknown as NotificationsService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('signature', () => {
    // The whole point: nothing is acted on until Stripe's signature verifies.
    it('verifies before anything else happens', async () => {
      stripe.constructWebhookEvent.mockImplementation(() => {
        throw new UnauthorizedException({ code: 'INVALID_WEBHOOK_SIGNATURE' });
      });

      await expect(service.handle(RAW_BODY, SIGNATURE)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(eventModel.create).not.toHaveBeenCalled();
      expect(payments.applyStatus).not.toHaveBeenCalled();
      expect(bookings.confirmAfterPayment).not.toHaveBeenCalled();
    });

    it('checks the raw bytes it was given', async () => {
      await service.handle(RAW_BODY, SIGNATURE);

      expect(stripe.constructWebhookEvent).toHaveBeenCalledWith(
        RAW_BODY,
        SIGNATURE,
      );
    });
  });

  describe('payment_intent.succeeded', () => {
    it('confirms the booking and notifies the user', async () => {
      const outcome = await service.handle(RAW_BODY, SIGNATURE);

      expect(payments.applyStatus).toHaveBeenCalledWith(
        new Types.ObjectId(PAYMENT_ID),
        PaymentStatus.REQUIRES_PAYMENT_METHOD,
        PaymentStatus.SUCCEEDED,
      );
      expect(bookings.confirmAfterPayment).toHaveBeenCalledWith(
        BookingType.HOTEL,
        BOOKING_ID,
        PAYMENT_ID,
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.BOOKING_CONFIRMED,
          message: expect.stringContaining('NILE-4821'),
        }),
      );
      expect(outcome).toEqual({
        received: true,
        status: WebhookEventStatus.PROCESSED,
        eventId: 'evt_1',
      });
    });

    it('puts the amount and currency in the notification', async () => {
      await service.handle(RAW_BODY, SIGNATURE);

      const notice = notifications.notify.mock.calls[0][0] as {
        message: string;
      };
      expect(notice.message).toContain('420.00 USD');
    });

    // Stripe retries until it gets a 2xx and can deliver twice anyway.
    it('does not confirm twice when the event is delivered again', async () => {
      const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
      eventModel.create.mockRejectedValue(duplicate);
      // The stored event is PROCESSED, so it cannot be claimed again.
      eventModel.findOneAndUpdate.mockReturnValue(exec(null));

      const outcome = await service.handle(RAW_BODY, SIGNATURE);

      expect(outcome.status).toBe(WebhookEventStatus.PROCESSED);
      expect(bookings.confirmAfterPayment).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    // Second guard: even if an event row were lost, the conditional status
    // update stops the booking being confirmed a second time.
    it('does not confirm when the payment was already recorded as succeeded', async () => {
      payments.applyStatus.mockResolvedValue(null);

      await service.handle(RAW_BODY, SIGNATURE);

      expect(bookings.confirmAfterPayment).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('records the event as PROCESSED when it is done', async () => {
      await service.handle(RAW_BODY, SIGNATURE);

      const [filter, update] = eventModel.updateOne.mock.calls[0] as [
        Filter,
        { $set: Record<string, unknown> },
      ];
      expect(filter).toEqual({ stripeEventId: 'evt_1' });
      expect(update.$set.status).toBe(WebhookEventStatus.PROCESSED);
      expect(update.$set.processedAt).toBeInstanceOf(Date);
    });

    it('does nothing for a PaymentIntent this platform never created', async () => {
      payments.findByStripeId.mockResolvedValue(null);

      const outcome = await service.handle(RAW_BODY, SIGNATURE);

      expect(outcome.status).toBe(WebhookEventStatus.PROCESSED);
      expect(bookings.confirmAfterPayment).not.toHaveBeenCalled();
    });

    // A 5xx is what makes Stripe retry, and FAILED lets the retry reclaim it.
    it('records a failure and rethrows so Stripe retries', async () => {
      bookings.confirmAfterPayment.mockRejectedValue(
        new Error('hotel module unavailable'),
      );

      await expect(service.handle(RAW_BODY, SIGNATURE)).rejects.toThrow(
        'hotel module unavailable',
      );
      const [, update] = eventModel.updateOne.mock.calls[0] as [
        Filter,
        { $set: Record<string, unknown> },
      ];
      expect(update.$set.status).toBe(WebhookEventStatus.FAILED);
      expect(update.$set.error).toBe('hotel module unavailable');
    });

    it('lets a retry reclaim an event whose first attempt failed', async () => {
      const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
      eventModel.create.mockRejectedValue(duplicate);
      eventModel.findOneAndUpdate.mockReturnValue(
        exec({ stripeEventId: 'evt_1' }),
      );

      await service.handle(RAW_BODY, SIGNATURE);

      const [filter] = eventModel.findOneAndUpdate.mock.calls[0] as [Filter];
      // Only a FAILED row may be retaken, never one in flight or finished.
      expect(filter).toEqual({
        stripeEventId: 'evt_1',
        status: WebhookEventStatus.FAILED,
      });
      expect(bookings.confirmAfterPayment).toHaveBeenCalled();
    });
  });

  describe('payment_intent.payment_failed', () => {
    beforeEach(() => {
      stripe.constructWebhookEvent.mockReturnValue(
        event('payment_intent.payment_failed', {
          last_payment_error: { message: 'Your card was declined.' },
        }),
      );
    });

    it('records the failure with Stripe’s message', async () => {
      await service.handle(RAW_BODY, SIGNATURE);

      expect(payments.applyStatus).toHaveBeenCalledWith(
        new Types.ObjectId(PAYMENT_ID),
        PaymentStatus.REQUIRES_PAYMENT_METHOD,
        PaymentStatus.FAILED,
        { failureMessage: 'Your card was declined.' },
      );
    });

    // PAY-01 lets the user retry until the hold expires, so the seats must
    // stay reserved after a failed attempt.
    it('does not release the hold: the user may still retry', async () => {
      await service.handle(RAW_BODY, SIGNATURE);

      expect(bookings.releaseHold).not.toHaveBeenCalled();
    });

    it('never confirms the booking', async () => {
      await service.handle(RAW_BODY, SIGNATURE);

      expect(bookings.confirmAfterPayment).not.toHaveBeenCalled();
    });
  });

  describe('payment_intent.canceled', () => {
    beforeEach(() => {
      stripe.constructWebhookEvent.mockReturnValue(
        event('payment_intent.canceled'),
      );
      payments.applyStatus.mockResolvedValue(
        paymentDoc({ status: PaymentStatus.CANCELLED }),
      );
    });

    it('releases the hold once', async () => {
      await service.handle(RAW_BODY, SIGNATURE);

      expect(bookings.releaseHold).toHaveBeenCalledWith(
        BookingType.HOTEL,
        BOOKING_ID,
        HoldReleaseReason.PAYMENT_FAILED,
      );
      expect(bookings.releaseHold).toHaveBeenCalledTimes(1);
    });

    it('does not release again when the status had already moved', async () => {
      payments.applyStatus.mockResolvedValue(null);

      await service.handle(RAW_BODY, SIGNATURE);

      expect(bookings.releaseHold).not.toHaveBeenCalled();
    });
  });

  describe('other event types', () => {
    it.each([
      'charge.succeeded',
      'customer.created',
      'payment_intent.created',
    ])('ignores %s without touching a booking', async (type) => {
      stripe.constructWebhookEvent.mockReturnValue(event(type));

      const outcome = await service.handle(RAW_BODY, SIGNATURE);

      expect(outcome.status).toBe(WebhookEventStatus.IGNORED);
      expect(payments.applyStatus).not.toHaveBeenCalled();
      expect(bookings.confirmAfterPayment).not.toHaveBeenCalled();
      expect(bookings.releaseHold).not.toHaveBeenCalled();
    });

    it('still records an ignored event, so it is not reprocessed', async () => {
      stripe.constructWebhookEvent.mockReturnValue(event('charge.succeeded'));

      await service.handle(RAW_BODY, SIGNATURE);

      const [, update] = eventModel.updateOne.mock.calls[0] as [
        Filter,
        { $set: Record<string, unknown> },
      ];
      expect(update.$set.status).toBe(WebhookEventStatus.IGNORED);
    });
  });

  describe('event claim row', () => {
    it('stores the event id, type and booking', async () => {
      await service.handle(RAW_BODY, SIGNATURE);

      const created = eventModel.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(created).toMatchObject({
        stripeEventId: 'evt_1',
        type: 'payment_intent.succeeded',
        bookingId: new Types.ObjectId(BOOKING_ID),
        status: WebhookEventStatus.PROCESSING,
      });
    });

    it('stores a null booking when the metadata has none or it is junk', async () => {
      stripe.constructWebhookEvent.mockReturnValue(
        event('payment_intent.succeeded', { metadata: { bookingId: 'junk' } }),
      );

      await service.handle(RAW_BODY, SIGNATURE);

      const created = eventModel.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(created.bookingId).toBeNull();
    });
  });
});
