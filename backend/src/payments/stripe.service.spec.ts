import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { BookingType } from '../common/bookings/booking-status';
import { StripeService } from './stripe.service';

const WEBHOOK_SECRET = 'whsec_testsecretforsignatureverification';

function serviceWith(env: Record<string, string | undefined>): StripeService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new StripeService(config);
}

describe('StripeService (PAY-01)', () => {
  describe('without a secret key', () => {
    const service = serviceWith({});

    it('reports itself as not configured', () => {
      expect(service.isConfigured).toBe(false);
    });

    // The app has to start for everyone, not just whoever holds a Stripe key.
    it('warns on init instead of refusing to start', () => {
      expect(() => service.onModuleInit()).not.toThrow();
    });

    it.each([
      [
        'createPaymentIntent',
        () =>
          service.createPaymentIntent({
            amount: '10.00',
            idempotencyKey: 'k',
            bookingType: BookingType.HOTEL,
            bookingId: '6720f1c2a1b2c3d4e5f60718',
            userId: '6720f1c2a1b2c3d4e5f60001',
          }),
      ],
      ['retrievePaymentIntent', () => service.retrievePaymentIntent('pi_1')],
      ['cancelPaymentIntent', () => service.cancelPaymentIntent('pi_1')],
    ])('%s answers 503 PAYMENTS_UNAVAILABLE', async (_name, call) => {
      await expect(call()).rejects.toMatchObject({
        response: { code: 'PAYMENTS_UNAVAILABLE' },
      });
      await expect(call()).rejects.toThrow(ServiceUnavailableException);
    });

    it('cannot verify a webhook either', () => {
      expect(() =>
        service.constructWebhookEvent(Buffer.from('{}'), 'sig'),
      ).toThrow(ServiceUnavailableException);
    });
  });

  describe('webhook signature verification', () => {
    // Real verification, no network: Stripe's own helper signs a payload with
    // the same secret the service checks against.
    const service = serviceWith({
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    const stripe = new Stripe('sk_test_placeholder');

    const payload = JSON.stringify({
      id: 'evt_test_1',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_1', object: 'payment_intent' } },
    });

    function sign(body: string, secret = WEBHOOK_SECRET): string {
      return stripe.webhooks.generateTestHeaderString({
        payload: body,
        secret,
      });
    }

    it('accepts a correctly signed body and returns the event', () => {
      const event = service.constructWebhookEvent(
        Buffer.from(payload),
        sign(payload),
      );

      expect(event.id).toBe('evt_test_1');
      expect(event.type).toBe('payment_intent.succeeded');
    });

    it('rejects a signature made with another secret (401)', () => {
      expect(() =>
        service.constructWebhookEvent(
          Buffer.from(payload),
          sign(payload, 'whsec_someoneelsessecret'),
        ),
      ).toThrow(UnauthorizedException);
    });

    // This is the attack the whole design exists to stop: a caller posting a
    // "payment succeeded" body of their own invention.
    it('rejects a body that was changed after signing (401)', () => {
      const signature = sign(payload);
      const tampered = payload.replace('pi_test_1', 'pi_someone_elses');

      expect(() =>
        service.constructWebhookEvent(Buffer.from(tampered), signature),
      ).toThrow(UnauthorizedException);
    });

    it('rejects an unsigned or nonsense signature header (401)', () => {
      for (const header of ['', 'nonsense', 't=1,v1=deadbeef']) {
        expect(() =>
          service.constructWebhookEvent(Buffer.from(payload), header),
        ).toThrow(UnauthorizedException);
      }
    });

    it('gives the same vague message whatever was wrong', () => {
      const attempt = () =>
        service.constructWebhookEvent(Buffer.from(payload), 'nonsense');

      expect(attempt).toThrow(
        expect.objectContaining({
          response: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Invalid webhook signature' },
        }) as never,
      );
    });
  });

  describe('error translation', () => {
    const service = serviceWith({ STRIPE_SECRET_KEY: 'sk_test_placeholder' });

    function stripeClient(): {
      paymentIntents: { create: jest.Mock; retrieve: jest.Mock; cancel: jest.Mock };
      refunds: { create: jest.Mock };
    } {
      return (service as unknown as { client: never })
        .client as unknown as ReturnType<typeof stripeClient>;
    }

    const create = () =>
      service.createPaymentIntent({
        amount: '10.00',
        idempotencyKey: 'k',
        bookingType: BookingType.HOTEL,
        bookingId: '6720f1c2a1b2c3d4e5f60718',
        userId: '6720f1c2a1b2c3d4e5f60001',
      });

    it('turns a declined card into 400 with Stripe’s own message', async () => {
      const cardError = new Stripe.errors.StripeCardError({
        type: 'card_error',
        message: 'Your card was declined.',
      });
      jest
        .spyOn(stripeClient().paymentIntents, 'create')
        .mockRejectedValue(cardError);

      await expect(create()).rejects.toThrow(BadRequestException);
      await expect(create()).rejects.toMatchObject({
        response: {
          code: 'CARD_DECLINED',
          message: 'Your card was declined.',
        },
      });
    });

    // A Stripe outage is not the client's fault, so it must not look like a
    // bad request the client should change.
    it('turns an outage into 503, not 400', async () => {
      jest
        .spyOn(stripeClient().paymentIntents, 'create')
        .mockRejectedValue(
          new Stripe.errors.StripeConnectionError({
            type: 'api_connection_error',
            message: 'network down',
          }),
        );

      await expect(create()).rejects.toMatchObject({
        response: { code: 'STRIPE_UNAVAILABLE' },
      });
    });

    it('does not leak Stripe internals in a 503 message', async () => {
      jest
        .spyOn(stripeClient().paymentIntents, 'create')
        .mockRejectedValue(new Error('secret internal detail'));

      await expect(create()).rejects.toMatchObject({
        response: {
          message: 'The payment provider is unavailable, please try again',
        },
      });
    });
  });

  describe('createPaymentIntent request', () => {
    const service = serviceWith({ STRIPE_SECRET_KEY: 'sk_test_placeholder' });
    const client = (
      service as unknown as {
        client: { paymentIntents: { create: jest.Mock } };
      }
    ).client;

    it('sends whole minor units, the platform currency and the booking metadata', async () => {
      const create = jest
        .spyOn(client.paymentIntents, 'create')
        .mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method' } as never);

      await service.createPaymentIntent({
        amount: '19.99',
        idempotencyKey: 'pay:HOTEL:6720f1c2a1b2c3d4e5f60718:1',
        bookingType: BookingType.HOTEL,
        bookingId: '6720f1c2a1b2c3d4e5f60718',
        userId: '6720f1c2a1b2c3d4e5f60001',
      });

      const [params, options] = create.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      // 19.99 * 100 as a double is 1998.9999999999998; this must be 1999.
      expect(params.amount).toBe(1999);
      expect(params.currency).toBe('usd');
      expect(params.metadata).toEqual({
        bookingType: 'HOTEL',
        bookingId: '6720f1c2a1b2c3d4e5f60718',
        userId: '6720f1c2a1b2c3d4e5f60001',
      });
      // The idempotency key is what stops a repeated request opening a second
      // PaymentIntent for the same attempt.
      expect(options.idempotencyKey).toBe(
        'pay:HOTEL:6720f1c2a1b2c3d4e5f60718:1',
      );
    });
  });

  describe('cancelPaymentIntent', () => {
    const service = serviceWith({ STRIPE_SECRET_KEY: 'sk_test_placeholder' });
    const client = (
      service as unknown as {
        client: { paymentIntents: { cancel: jest.Mock } };
      }
    ).client;

    // The expiry sweep must be safe to repeat, and Stripe refuses to cancel a
    // PaymentIntent it has already finished.
    it('treats an already-finished intent as done, not an error', async () => {
      jest.spyOn(client.paymentIntents, 'cancel').mockRejectedValue(
        new Stripe.errors.StripeInvalidRequestError({
          type: 'invalid_request_error',
          message:
            'You cannot cancel this PaymentIntent because it has already been canceled.',
        }),
      );

      await expect(service.cancelPaymentIntent('pi_1')).resolves.toBeNull();
    });

    it('still reports a real failure', async () => {
      jest
        .spyOn(client.paymentIntents, 'cancel')
        .mockRejectedValue(new Error('network down'));

      await expect(service.cancelPaymentIntent('pi_1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
