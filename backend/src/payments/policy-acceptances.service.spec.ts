import { NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { PolicyAcceptancesService } from './policy-acceptances.service';
import { PolicyAcceptance } from './schemas/policy-acceptance.schema';

type Filter = Record<string, unknown>;

describe('PolicyAcceptancesService (PAY-02)', () => {
  const USER_ID = '6720f1c2a1b2c3d4e5f60001';
  const OTHER_USER_ID = '6720f1c2a1b2c3d4e5f60002';
  const BOOKING_ID = '6720f1c2a1b2c3d4e5f60718';
  const PROVIDER_ID = '6720f1c2a1b2c3d4e5f60800';
  const ACCEPTED_AT = new Date('2026-11-09T12:00:00.000Z');

  let model: { findOne: jest.Mock; create: jest.Mock };
  let bookings: {
    getPayableOrThrow: jest.Mock;
    getPoliciesOrThrow: jest.Mock;
  };
  let service: PolicyAcceptancesService;

  const exec = (value: unknown) => ({
    exec: jest.fn().mockResolvedValue(value),
  });

  const policySnapshot = {
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationTiers: [{ daysBeforeCheckIn: 7, refundPercentage: 100 }],
  };

  function acceptanceDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId('6720f1c2a1b2c3d4e5f60900'),
      bookingType: BookingType.HOTEL,
      bookingId: new Types.ObjectId(BOOKING_ID),
      userId: new Types.ObjectId(USER_ID),
      providerType: ProviderType.HOTEL,
      providerId: PROVIDER_ID,
      policyVersion: 1,
      policySnapshot,
      accepted: true,
      acceptedAt: ACCEPTED_AT,
      ...overrides,
    };
  }

  beforeEach(() => {
    model = {
      findOne: jest.fn().mockReturnValue(exec(null)),
      create: jest.fn().mockImplementation((doc) =>
        Promise.resolve({
          ...acceptanceDoc(),
          ...doc,
        }),
      ),
    };
    bookings = {
      getPayableOrThrow: jest.fn().mockResolvedValue({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        userId: USER_ID,
        status: BookingStatus.PENDING_PAYMENT,
        totalAmount: '199.99',
        currency: 'USD',
        holdExpiresAt: new Date(),
        bookingReference: null,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
      }),
      getPoliciesOrThrow: jest.fn().mockResolvedValue({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
        policyVersion: 1,
        policySnapshot,
      }),
    };

    service = new PolicyAcceptancesService(
      model as unknown as Model<PolicyAcceptance>,
      bookings as unknown as BookingsGateway,
    );
  });

  describe('getPolicies', () => {
    it('returns the booking’s terms, not yet accepted', async () => {
      const result = await service.getPolicies(
        USER_ID,
        BookingType.HOTEL,
        BOOKING_ID,
      );

      expect(result).toEqual({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
        policyVersion: 1,
        policySnapshot,
        accepted: false,
        acceptedAt: null,
      });
    });

    it('reports an existing acceptance with its timestamp', async () => {
      model.findOne.mockReturnValue(exec(acceptanceDoc()));

      const result = await service.getPolicies(
        USER_ID,
        BookingType.HOTEL,
        BOOKING_ID,
      );

      expect(result.accepted).toBe(true);
      expect(result.acceptedAt).toBe(ACCEPTED_AT.toISOString());
    });

    // ACC-11: indistinguishable from a booking that does not exist.
    it('answers 404 for another account’s booking', async () => {
      bookings.getPayableOrThrow.mockResolvedValue({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        userId: OTHER_USER_ID,
        status: BookingStatus.PENDING_PAYMENT,
        totalAmount: '199.99',
        currency: 'USD',
        holdExpiresAt: new Date(),
        bookingReference: null,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
      });

      await expect(
        service.getPolicies(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).rejects.toThrow(NotFoundException);
      expect(bookings.getPoliciesOrThrow).not.toHaveBeenCalled();
    });

    it('is readable before and after payment, unlike accepting', async () => {
      bookings.getPayableOrThrow.mockResolvedValue({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        userId: USER_ID,
        status: BookingStatus.CONFIRMED,
        totalAmount: '199.99',
        currency: 'USD',
        holdExpiresAt: null,
        bookingReference: 'NILE-4821',
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
      });

      await expect(
        service.getPolicies(USER_ID, BookingType.HOTEL, BOOKING_ID),
      ).resolves.toMatchObject({ policyVersion: 1 });
    });
  });

  describe('accept', () => {
    it('stores the exact terms, the version and the moment', async () => {
      const result = await service.accept(
        USER_ID,
        BookingType.HOTEL,
        BOOKING_ID,
        1,
      );

      const created = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created).toMatchObject({
        bookingType: BookingType.HOTEL,
        bookingId: new Types.ObjectId(BOOKING_ID),
        userId: new Types.ObjectId(USER_ID),
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
        policyVersion: 1,
        policySnapshot,
        accepted: true,
      });
      expect(created.acceptedAt).toBeInstanceOf(Date);
      expect(result.accepted).toBe(true);
    });

    it('returns the first acceptance instead of writing a second', async () => {
      model.findOne.mockReturnValue(exec(acceptanceDoc()));

      const result = await service.accept(
        USER_ID,
        BookingType.HOTEL,
        BOOKING_ID,
        1,
      );

      expect(model.create).not.toHaveBeenCalled();
      // The recorded moment stays the moment the user actually agreed.
      expect(result.acceptedAt).toBe(ACCEPTED_AT.toISOString());
    });

    // Two clicks arriving together: the unique index rejects the second write,
    // and the endpoint still answers with the acceptance that won.
    it('survives a race on the unique index', async () => {
      const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
      model.create.mockRejectedValue(duplicate);
      model.findOne
        .mockReturnValueOnce(exec(null))
        .mockReturnValueOnce(exec(acceptanceDoc()));

      const result = await service.accept(
        USER_ID,
        BookingType.HOTEL,
        BOOKING_ID,
        1,
      );

      expect(result.acceptedAt).toBe(ACCEPTED_AT.toISOString());
    });

    it('rethrows a write error that is not a duplicate key', async () => {
      model.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.accept(USER_ID, BookingType.HOTEL, BOOKING_ID, 1),
      ).rejects.toThrow('connection lost');
    });

    // Acceptance must be for terms that were really displayed.
    it('refuses a stale policy version (409)', async () => {
      await expect(
        service.accept(USER_ID, BookingType.HOTEL, BOOKING_ID, 0),
      ).rejects.toMatchObject({
        response: { code: 'POLICY_VERSION_MISMATCH' },
      });
      expect(model.create).not.toHaveBeenCalled();
    });

    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
      BookingStatus.COMPLETED,
    ])('refuses a %s booking (409)', async (status) => {
      bookings.getPayableOrThrow.mockResolvedValue({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        userId: USER_ID,
        status,
        totalAmount: '199.99',
        currency: 'USD',
        holdExpiresAt: null,
        bookingReference: null,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
      });

      await expect(
        service.accept(USER_ID, BookingType.HOTEL, BOOKING_ID, 1),
      ).rejects.toMatchObject({
        response: { code: 'BOOKING_NOT_AWAITING_PAYMENT' },
      });
    });

    it('answers 404 for another account’s booking', async () => {
      bookings.getPayableOrThrow.mockResolvedValue({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        userId: OTHER_USER_ID,
        status: BookingStatus.PENDING_PAYMENT,
        totalAmount: '199.99',
        currency: 'USD',
        holdExpiresAt: new Date(),
        bookingReference: null,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
      });

      await expect(
        service.accept(USER_ID, BookingType.HOTEL, BOOKING_ID, 1),
      ).rejects.toThrow(NotFoundException);
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('find and findForBooking (used by PAY-01)', () => {
    it('looks the acceptance up by booking and version', async () => {
      await service.find(BookingType.HOTEL, BOOKING_ID, 3);

      const [filter] = model.findOne.mock.calls[0] as [Filter];
      expect(filter).toEqual({
        bookingType: BookingType.HOTEL,
        bookingId: new Types.ObjectId(BOOKING_ID),
        policyVersion: 3,
      });
    });

    it('returns null for a malformed booking id without querying', async () => {
      await expect(
        service.find(BookingType.HOTEL, 'not-an-id', 1),
      ).resolves.toBeNull();
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('uses the version the booking is currently on', async () => {
      bookings.getPoliciesOrThrow.mockResolvedValue({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
        policyVersion: 7,
        policySnapshot,
      });

      await service.findForBooking(BookingType.HOTEL, BOOKING_ID);

      const [filter] = model.findOne.mock.calls[0] as [Filter];
      expect(filter.policyVersion).toBe(7);
    });
  });
});
