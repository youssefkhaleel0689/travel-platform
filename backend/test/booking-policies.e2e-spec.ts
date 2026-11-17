// PAY-02 end to end against the shared database.
//
// The hotels module does not provide its BookingsPort yet (flights do since
// FLT-22, tested in flight-bookings.e2e-spec.ts), so the gateway is stood in
// for here: the suite supplies one booking's facts and policies and drives the
// real HTTP path through the guard, the parameter validation, the ownership
// check and the policyAcceptances collection. When B2 wires the hotel port
// in, only the two spies below go away.
import { INestApplication, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
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
import { PolicyAcceptance } from './../src/payments/schemas/policy-acceptance.schema';
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
const POLICY_SNAPSHOT = {
  checkInTime: '14:00',
  checkOutTime: '12:00',
  cancellationTiers: [
    { daysBeforeCheckIn: 7, refundPercentage: 100 },
    { daysBeforeCheckIn: 2, refundPercentage: 50 },
  ],
};

describe('Booking policies (e2e)', () => {
  let app: INestApplication<App>;
  let acceptanceModel: Model<PolicyAcceptance>;
  const createdUserIds: string[] = [];
  let owner: SignedInUser;
  let other: SignedInUser;

  let bookingId: string;
  let bookingStatus: BookingStatus;
  let policyVersion: number;

  function policiesPath(id = bookingId, type = 'hotel'): string {
    return `/api/bookings/${type}/${id}/policies`;
  }
  function acceptPath(id = bookingId, type = 'hotel'): string {
    return `/api/bookings/${type}/${id}/accept-policies`;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    acceptanceModel = app.get<Model<PolicyAcceptance>>(
      getModelToken(PolicyAcceptance.name),
    );
    owner = await createSignedInUser(app, { label: 'pay2-owner' });
    other = await createSignedInUser(app, { label: 'pay2-other' });
    createdUserIds.push(owner.userId, other.userId);

  }, CONNECT_TIMEOUT_MS);

  /** Stands in for the port a booking module will provide. */
  function standInForBookingModule(): void {
    const gateway = app.get(BookingsGateway);
    jest
      .spyOn(gateway, 'getPayableOrThrow')
      .mockImplementation((type, id) => {
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
    jest
      .spyOn(gateway, 'getPoliciesOrThrow')
      .mockImplementation((type, id) =>
        Promise.resolve({
          bookingId: id,
          bookingType: type,
          providerType: ProviderType.HOTEL,
          providerId: PROVIDER_ID,
          policyVersion,
          policySnapshot: POLICY_SNAPSHOT,
        }),
      );
  }

  afterAll(async () => {
    await acceptanceModel
      .deleteMany({
        userId: { $in: createdUserIds.map((id) => new Types.ObjectId(id)) },
      })
      .exec();
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  beforeEach(() => {
    // A fresh booking id per test, so acceptances never carry over.
    bookingId = new Types.ObjectId().toString();
    bookingStatus = BookingStatus.PENDING_PAYMENT;
    policyVersion = 1;
    standInForBookingModule();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/bookings/:type/:id/policies', () => {
    it('shows the terms, not yet accepted', async () => {
      const res = await request(app.getHttpServer())
        .get(policiesPath())
        .set('Cookie', owner.cookie)
        .expect(200);

      expect(res.body).toEqual({
        bookingId,
        bookingType: BookingType.HOTEL,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
        policyVersion: 1,
        policySnapshot: POLICY_SNAPSHOT,
        accepted: false,
        acceptedAt: null,
      });
    });

    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer()).get(policiesPath()).expect(401);
    });

    // ACC-11: another account's booking looks exactly like one that is not there.
    it('answers 404 for another account’s booking', async () => {
      const res = await request(app.getHttpServer())
        .get(policiesPath())
        .set('Cookie', other.cookie)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    // An empty type is not a validation error: /api/bookings//:id/policies
    // matches no route at all, so the router answers 404 first.
    it.each(['cruise', 'flights', 'hotels'])(
      'rejects the booking type "%s" with a field error',
      async (type) => {
        const res = await request(app.getHttpServer())
          .get(policiesPath(bookingId, type))
          .set('Cookie', owner.cookie)
          .expect(400);

        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(res.body.errors[0].field).toBe('type');
      },
    );

    // The type is upper-cased before the enum check, so a URL may spell it
    // either way and the enum still has one spelling in the code.
    it.each(['hotel', 'HOTEL', 'Hotel'])(
      'accepts the booking type "%s"',
      async (type) => {
        const res = await request(app.getHttpServer())
          .get(policiesPath(bookingId, type))
          .set('Cookie', owner.cookie)
          .expect(200);

        expect(res.body.bookingType).toBe(BookingType.HOTEL);
      },
    );

    it('rejects a malformed booking id with a field error', async () => {
      const res = await request(app.getHttpServer())
        .get(policiesPath('not-an-id'))
        .set('Cookie', owner.cookie)
        .expect(400);

      expect(res.body.errors[0].field).toBe('id');
    });

    // The real 501 path. Flights provide their port since FLT-22, so the
    // hotels module, not built yet, is the type with no module connected: the
    // stand-in is dropped and the gateway answers for itself.
    it('answers 501 for a booking type with no module connected', async () => {
      jest.restoreAllMocks();

      const res = await request(app.getHttpServer())
        .get(policiesPath(bookingId, 'hotel'))
        .set('Cookie', owner.cookie)
        .expect(501);

      expect(res.body.code).toBe('BOOKING_TYPE_UNAVAILABLE');
    });
  });

  describe('POST /api/bookings/:type/:id/accept-policies', () => {
    it('records the acceptance with the exact terms and a timestamp', async () => {
      const res = await request(app.getHttpServer())
        .post(acceptPath())
        .set('Cookie', owner.cookie)
        .send({ accepted: true, policyVersion: 1 })
        .expect(200);

      expect(res.body).toEqual({
        id: expect.stringMatching(/^[a-f\d]{24}$/),
        bookingId,
        bookingType: BookingType.HOTEL,
        providerType: ProviderType.HOTEL,
        providerId: PROVIDER_ID,
        policyVersion: 1,
        accepted: true,
        acceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        policySnapshot: POLICY_SNAPSHOT,
      });

      // The policies endpoint now reports it as accepted.
      const policies = await request(app.getHttpServer())
        .get(policiesPath())
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(policies.body.accepted).toBe(true);
      expect(policies.body.acceptedAt).toBe(res.body.acceptedAt);
    });

    it('is idempotent and keeps the first timestamp', async () => {
      const first = await request(app.getHttpServer())
        .post(acceptPath())
        .set('Cookie', owner.cookie)
        .send({ accepted: true, policyVersion: 1 })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post(acceptPath())
        .set('Cookie', owner.cookie)
        .send({ accepted: true, policyVersion: 1 })
        .expect(200);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.acceptedAt).toBe(first.body.acceptedAt);
      await expect(
        acceptanceModel
          .countDocuments({ bookingId: new Types.ObjectId(bookingId) })
          .exec(),
      ).resolves.toBe(1);
    });

    // Two clicks at the same instant: the unique index decides, and both
    // requests still get the same acceptance back.
    it('survives two simultaneous acceptances', async () => {
      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post(acceptPath())
          .set('Cookie', owner.cookie)
          .send({ accepted: true, policyVersion: 1 }),
        request(app.getHttpServer())
          .post(acceptPath())
          .set('Cookie', owner.cookie)
          .send({ accepted: true, policyVersion: 1 }),
      ]);

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.id).toBe(b.body.id);
      await expect(
        acceptanceModel
          .countDocuments({ bookingId: new Types.ObjectId(bookingId) })
          .exec(),
      ).resolves.toBe(1);
    });

    it('refuses a version the user was not shown (409)', async () => {
      const res = await request(app.getHttpServer())
        .post(acceptPath())
        .set('Cookie', owner.cookie)
        .send({ accepted: true, policyVersion: 99 })
        .expect(409);

      expect(res.body.code).toBe('POLICY_VERSION_MISMATCH');
      await expect(
        acceptanceModel
          .countDocuments({ bookingId: new Types.ObjectId(bookingId) })
          .exec(),
      ).resolves.toBe(0);
    });

    it.each([
      [{ accepted: false, policyVersion: 1 }, 'accepted'],
      [{ policyVersion: 1 }, 'accepted'],
      [{ accepted: true }, 'policyVersion'],
      [{ accepted: true, policyVersion: 'one' }, 'policyVersion'],
      [{ accepted: true, policyVersion: -1 }, 'policyVersion'],
    ])('refuses the body %o with a field error on %s', async (body, field) => {
      const res = await request(app.getHttpServer())
        .post(acceptPath())
        .set('Cookie', owner.cookie)
        .send(body)
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
        field,
      );
    });

    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
    ])('refuses a %s booking (409)', async (status) => {
      bookingStatus = status;

      const res = await request(app.getHttpServer())
        .post(acceptPath())
        .set('Cookie', owner.cookie)
        .send({ accepted: true, policyVersion: 1 })
        .expect(409);

      expect(res.body.code).toBe('BOOKING_NOT_AWAITING_PAYMENT');
    });

    it('answers 404 for another account’s booking', async () => {
      await request(app.getHttpServer())
        .post(acceptPath())
        .set('Cookie', other.cookie)
        .send({ accepted: true, policyVersion: 1 })
        .expect(404);
    }, SLOW_MS);

    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer())
        .post(acceptPath())
        .send({ accepted: true, policyVersion: 1 })
        .expect(401);
    });

    // A provider editing its policy raises the version, which leaves the old
    // acceptance in place as the record of what was agreed then.
    it('keeps the old acceptance when the version moves on', async () => {
      await request(app.getHttpServer())
        .post(acceptPath())
        .set('Cookie', owner.cookie)
        .send({ accepted: true, policyVersion: 1 })
        .expect(200);

      policyVersion = 2;

      const policies = await request(app.getHttpServer())
        .get(policiesPath())
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(policies.body.policyVersion).toBe(2);
      expect(policies.body.accepted).toBe(false);

      await request(app.getHttpServer())
        .post(acceptPath())
        .set('Cookie', owner.cookie)
        .send({ accepted: true, policyVersion: 2 })
        .expect(200);

      // Both acceptances are on record, one per version.
      await expect(
        acceptanceModel
          .countDocuments({ bookingId: new Types.ObjectId(bookingId) })
          .exec(),
      ).resolves.toBe(2);
    });
  });
});
