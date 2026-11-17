import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { PaymentStatus } from './payment-status.enum';
import { PaymentsService } from './payments.service';
import { PolicyAcceptancesService } from './policy-acceptances.service';
import { Payment } from './schemas/payment.schema';
import { StripeService } from './stripe.service';

type Filter = Record<string, unknown>;

describe('PaymentsService (PAY-01)', () => {
  const USER_ID = '6720f1c2a1b2c3d4e5f60001';
  const OTHER_USER_ID = '6720f1c2a1b2c3d4e5f60002';
  const BOOKING_ID = '6720f1c2a1b2c3d4e5f60718';
  const PAYMENT_ID = '6720f1c2a1b2c3d4e5f60910';
  const ACCEPTANCE_ID = '6720f1c2a1b2c3d4e5f60900';

  let model: {
    create: jest.Mock;
    findOne: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    countDocuments: jest.Mock;
    find: jest.Mock;
  };
  let stripe: {
    createPaymentIntent: jest.Mock;
    retrievePaymentIntent: jest.Mock;
  };
  let bookings: { getPayableOrThrow: jest.Mock };
  let policies: { findForBooking: jest.Mock };
  let service: PaymentsService;

  const exec = (value: unknown) => ({
    exec: jest.fn().mockResolvedValue(value),
  });
  const sortExec = (value: unknown) => ({
    sort: jest.fn().mockReturnValue(exec(value)),
  });

  function booking(overrides: Record<string, unknown> = {}) {
    return {
      bookingId: BOOKING_ID,
      bookingType: BookingType.HOTEL,
      userId: USER_ID,
      status: BookingStatus.PENDING_PAYMENT,
      totalAmount: '420.00',
      currency: 'USD',
      holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      bookingReference: null,
      providerType: ProviderType.HOTEL,
      providerId: '6720f1c2a1b2c3d4e5f60800',
      ...overrides,
    };
  }

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
      policyAcceptanceId: new Types.ObjectId(ACCEPTANCE_ID),
      idempotencyKey: `pay:HOTEL:${BOOKING_ID}:1`,
      attempt: 1,
      succeededAt: null,
      failedAt: null,
      cancelledAt: null,
      failureMessage: null,
      createdAt: new Date('2026-11-09T12:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    model = {
      create: jest.fn().mockImplementation((doc) =>
        Promise.resolve(paymentDoc(doc as Record<string, unknown>)),
      ),
      findOne: jest.fn().mockReturnValue(sortExec(null)),
      findById: jest.fn().mockReturnValue(exec(paymentDoc())),
      findOneAndUpdate: jest.fn().mockReturnValue(exec(paymentDoc())),
      countDocuments: jest.fn().mockReturnValue(exec(1)),
      find: jest.fn(),
    };
    stripe = {
      createPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_1',
        status: 'requires_payment_method',
        client_secret: 'pi_1_secret_abc',
      }),
      retrievePaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_1',
        status: 'requires_payment_method',
        client_secret: 'pi_1_secret_abc',
      }),
    };
    bookings = { getPayableOrThrow: jest.fn().mockResolvedValue(booking()) };
    policies = {
      findForBooking: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(ACCEPTANCE_ID) }),
    };

    service = new PaymentsService(
      model as unknown as Model<Payment>,
      stripe as unknown as StripeService,
      bookings as unknown as BookingsGateway,
      policies as unknown as PolicyAcceptancesService,
    );
  });

  describe('createForBooking', () => {
    it('opens a PaymentIntent for the booking’s own amount', async () => {
      const result = await service.createForBooking(
        USER_ID,
        BookingType.HOTEL,
        BOOKING_ID,
      );

      // The amount comes from the booking, never from the request.
      expect(stripe.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '420.00',
          bookingType: BookingType.HOTEL,
          bookingId: BOOKING_ID,
          userId: USER_ID,
          idempotencyKey: `pay:HOTEL:${BOOKING_ID}:1`,
        }),
      );
      expect(result.clientSecret).toBe('pi_1_secret_abc');
      expect(result.status).toBe(PaymentStatus.REQUIRES_PAYMENT_METHOD);
    });

    it('stores only the Stripe id, amount, currency and status', async () => {
      await service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID);

      const created = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.stripePaymentIntentId).toBe('pi_1');
      expect(created.currency).toBe('USD');
      expect(created.attempt).toBe(1);
      expect(created.policyAcceptanceId).toEqual(
        new Types.ObjectId(ACCEPTANCE_ID),
      );
      // Nothing card-shaped is ever written (noCardCredentials).
      const keys = Object.keys(created).join(' ');
      expect(keys).not.toMatch(/card|cvc|expiry|pan|secret/i);
    });

    // PAY-02: the gate that blocks payment until the terms are accepted.
    it('refuses when the policies have not been accepted (403)', async () => {
      policies.findForBooking.mockResolvedValue(null);

      await expect(
        service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).rejects.toMatchObject({ response: { code: 'POLICIES_NOT_ACCEPTED' } });
      await expect(
        service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    });

    // ACC-11: another account's booking is indistinguishable from none.
    it('refuses another account’s booking with 404', async () => {
      bookings.getPayableOrThrow.mockResolvedValue(
        booking({ userId: OTHER_USER_ID }),
      );

      await expect(
        service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).rejects.toThrow(NotFoundException);
      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    });

    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.COMPLETED,
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
    ])('refuses a %s booking (409)', async (status) => {
      bookings.getPayableOrThrow.mockResolvedValue(booking({ status }));

      await expect(
        service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).rejects.toMatchObject({
        response: { code: 'BOOKING_NOT_AWAITING_PAYMENT' },
      });
    });

    // Taking money after the hold has gone would sell inventory the platform
    // no longer has.
    it('refuses once the hold has expired (409)', async () => {
      bookings.getPayableOrThrow.mockResolvedValue(
        booking({ holdExpiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).rejects.toMatchObject({ response: { code: 'HOLD_EXPIRED' } });
      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    });

    // PAY-04: one platform currency, never converted.
    it('refuses a booking priced in another currency (409)', async () => {
      bookings.getPayableOrThrow.mockResolvedValue(
        booking({ currency: 'EGP' }),
      );

      await expect(
        service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).rejects.toMatchObject({
        response: { code: 'UNSUPPORTED_BOOKING_CURRENCY' },
      });
    });

    it('returns the attempt already open instead of opening a second', async () => {
      model.findOne.mockReturnValue(sortExec(paymentDoc()));

      const result = await service.createForBooking(
        USER_ID,
        BookingType.HOTEL,
        BOOKING_ID,
      );

      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
      expect(result.clientSecret).toBe('pi_1_secret_abc');
    });

    it('reports a booking that is already paid (409)', async () => {
      model.findOne.mockReturnValue(sortExec(paymentDoc()));
      stripe.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_1',
        status: 'succeeded',
        client_secret: null,
      });
      model.findOneAndUpdate.mockReturnValue(
        exec(paymentDoc({ status: PaymentStatus.SUCCEEDED })),
      );

      await expect(
        service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_PAID' } });
    });

    it('points a closed attempt at the retry endpoint (409)', async () => {
      model.findOne.mockReturnValue(
        sortExec(paymentDoc({ status: PaymentStatus.PROCESSING })),
      );
      stripe.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_1',
        status: 'requires_payment_method',
        client_secret: null,
      });
      model.findOneAndUpdate.mockReturnValue(
        exec(paymentDoc({ status: PaymentStatus.FAILED })),
      );

      await expect(
        service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).rejects.toMatchObject({
        response: { code: 'PAYMENT_ATTEMPT_CLOSED' },
      });
    });

    // Two clicks at once: Stripe's idempotency key means one PaymentIntent,
    // and the unique index means one row, so both callers get the same answer.
    it('survives a race on the unique index', async () => {
      const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
      model.create.mockRejectedValue(duplicate);
      model.findOne
        .mockReturnValueOnce(sortExec(null))
        .mockReturnValue(exec(paymentDoc()));

      const result = await service.createForBooking(
        USER_ID,
        BookingType.HOTEL,
        BOOKING_ID,
      );

      expect(result.stripePaymentIntentId).toBe('pi_1');
    });
  });

  describe('retry (PAY-01)', () => {
    it('opens a new attempt with the next attempt number', async () => {
      model.findById.mockReturnValue(
        exec(paymentDoc({ status: PaymentStatus.FAILED })),
      );
      stripe.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_1',
        status: 'requires_payment_method',
        client_secret: null,
      });
      model.findOneAndUpdate.mockReturnValue(
        exec(paymentDoc({ status: PaymentStatus.FAILED })),
      );
      model.countDocuments.mockReturnValue(exec(2));

      await service.retry(USER_ID, PAYMENT_ID);

      // A new key, so Stripe does not hand back the failed attempt.
      expect(stripe.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `pay:HOTEL:${BOOKING_ID}:3`,
        }),
      );
    });

    it('refuses to retry a payment that already succeeded (409)', async () => {
      model.findById.mockReturnValue(
        exec(paymentDoc({ status: PaymentStatus.SUCCEEDED })),
      );
      stripe.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_1',
        status: 'succeeded',
        client_secret: null,
      });

      await expect(service.retry(USER_ID, PAYMENT_ID)).rejects.toMatchObject({
        response: { code: 'ALREADY_PAID' },
      });
      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    });

    it('returns an attempt that is still open rather than opening another', async () => {
      const result = await service.retry(USER_ID, PAYMENT_ID);

      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
      expect(result.clientSecret).toBe('pi_1_secret_abc');
    });

    it('refuses to retry once the hold has expired (409)', async () => {
      model.findById.mockReturnValue(
        exec(paymentDoc({ status: PaymentStatus.FAILED })),
      );
      stripe.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_1',
        status: 'requires_payment_method',
        client_secret: null,
      });
      model.findOneAndUpdate.mockReturnValue(
        exec(paymentDoc({ status: PaymentStatus.FAILED })),
      );
      bookings.getPayableOrThrow.mockResolvedValue(
        booking({ holdExpiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.retry(USER_ID, PAYMENT_ID)).rejects.toMatchObject({
        response: { code: 'HOLD_EXPIRED' },
      });
    });

    it('answers 404 for another account’s payment', async () => {
      model.findById.mockReturnValue(
        exec(paymentDoc({ userId: new Types.ObjectId(OTHER_USER_ID) })),
      );

      await expect(service.retry(USER_ID, PAYMENT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getOwn', () => {
    it('refreshes the status from Stripe on every read', async () => {
      stripe.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_1',
        status: 'succeeded',
        client_secret: null,
      });
      model.findOneAndUpdate.mockReturnValue(
        exec(paymentDoc({ status: PaymentStatus.SUCCEEDED })),
      );

      const result = await service.getOwn(USER_ID, PAYMENT_ID);

      expect(stripe.retrievePaymentIntent).toHaveBeenCalledWith('pi_1');
      expect(result.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('returns a string amount, not a float', async () => {
      const result = await service.getOwn(USER_ID, PAYMENT_ID);

      expect(result.amount).toBe('420.00');
      expect(typeof result.amount).toBe('string');
    });

    it.each([PAYMENT_ID, 'not-an-id'])(
      'answers 404 for a missing or malformed id (%s)',
      async (id) => {
        model.findById.mockReturnValue(exec(null));

        await expect(service.getOwn(USER_ID, id)).rejects.toThrow(
          NotFoundException,
        );
      },
    );

    it('never exposes the client secret on a plain read', async () => {
      const result = await service.getOwn(USER_ID, PAYMENT_ID);

      expect(result).not.toHaveProperty('clientSecret');
    });
  });

  describe('applyStatus', () => {
    // The filter carries the status the caller believed, so two deliveries of
    // one event cannot both apply it.
    it('only moves a payment that is still in the expected status', async () => {
      await service.applyStatus(
        new Types.ObjectId(PAYMENT_ID),
        PaymentStatus.REQUIRES_PAYMENT_METHOD,
        PaymentStatus.SUCCEEDED,
      );

      const [filter, update] = model.findOneAndUpdate.mock.calls[0] as [
        Filter,
        { $set: Record<string, unknown> },
      ];
      expect(filter.status).toBe(PaymentStatus.REQUIRES_PAYMENT_METHOD);
      expect(update.$set.status).toBe(PaymentStatus.SUCCEEDED);
      expect(update.$set.succeededAt).toBeInstanceOf(Date);
    });

    it('does nothing when the status is unchanged', async () => {
      await expect(
        service.applyStatus(
          new Types.ObjectId(PAYMENT_ID),
          PaymentStatus.SUCCEEDED,
          PaymentStatus.SUCCEEDED,
        ),
      ).resolves.toBeNull();
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('records the failure message and the right timestamp per status', async () => {
      await service.applyStatus(
        new Types.ObjectId(PAYMENT_ID),
        PaymentStatus.PROCESSING,
        PaymentStatus.FAILED,
        { failureMessage: 'Your card was declined.' },
      );

      const [, update] = model.findOneAndUpdate.mock.calls[0] as [
        Filter,
        { $set: Record<string, unknown> },
      ];
      expect(update.$set.failedAt).toBeInstanceOf(Date);
      expect(update.$set.failureMessage).toBe('Your card was declined.');
      expect(update.$set.succeededAt).toBeUndefined();
    });

    it('returns null when another writer got there first', async () => {
      model.findOneAndUpdate.mockReturnValue(exec(null));

      await expect(
        service.applyStatus(
          new Types.ObjectId(PAYMENT_ID),
          PaymentStatus.REQUIRES_PAYMENT_METHOD,
          PaymentStatus.SUCCEEDED,
        ),
      ).resolves.toBeNull();
    });
  });

  describe('findSucceededForBooking (used by PAY-03)', () => {
    it('looks for the succeeded payment of that booking', async () => {
      model.findOne.mockReturnValue(exec(paymentDoc()));

      await service.findSucceededForBooking(BookingType.HOTEL, BOOKING_ID);

      const [filter] = model.findOne.mock.calls[0] as [Filter];
      expect(filter).toEqual({
        bookingType: BookingType.HOTEL,
        bookingId: new Types.ObjectId(BOOKING_ID),
        status: PaymentStatus.SUCCEEDED,
      });
    });

    it('returns null for a malformed booking id without querying', async () => {
      await expect(
        service.findSucceededForBooking(BookingType.HOTEL, 'nope'),
      ).resolves.toBeNull();
      expect(model.findOne).not.toHaveBeenCalled();
    });
  });

  it('uses ConflictException for every state clash', async () => {
    bookings.getPayableOrThrow.mockResolvedValue(
      booking({ status: BookingStatus.CONFIRMED }),
    );

    await expect(
      service.createForBooking(USER_ID, BookingType.HOTEL, BOOKING_ID),
    ).rejects.toThrow(ConflictException);
  });
});
