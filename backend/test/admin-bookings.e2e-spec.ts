// ACC-17 end to end against the shared database.
//
// What is real here: the HTTP route, the guards and the roles, the query
// validation, BookingsGateway's merge of the two modules into one page, the
// DTO mapping, and the account names and addresses, which come from the real
// users collection through UsersService.
//
// What is stood in for: the two BookingsPorts. listForAdmin is optional on the
// port and neither shipped adapter implements it yet, so the stand-ins below
// play the part A1 and B2 will play - and, because they record the filter they
// were handed, they are also how this suite proves that what the admin typed
// reaches the module unchanged. When those adapters implement listForAdmin,
// only the stand-ins go away.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role } from './../src/common/auth/auth.enums';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from './../src/common/bookings/booking-status';
import {
  FLIGHT_BOOKINGS_PORT,
  HOTEL_BOOKINGS_PORT,
} from './../src/common/bookings/bookings.port';
import type {
  AdminBookingFilter,
  AdminBookingList,
  AdminBookingRow,
} from './../src/common/bookings/bookings.port';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

// Connecting to Atlas, building indexes and two bcrypt hashes at 12 rounds.
const CONNECT_TIMEOUT_MS = 120_000;
const BOOKINGS = '/api/admin/bookings';

const AIRLINE_ID = '6720f1c2a1b2c3d4e5f60801';
const HOTEL_ID = '6720f1c2a1b2c3d4e5f60802';
const FLIGHT_REFERENCE = 'K7M2QX';
const HOTEL_REFERENCE = 'HTL-8F2A19C04B';

interface BookingRow {
  id: string;
  type: BookingType;
  reference: string | null;
  user: { id: string; name: string | null; email: string | null };
  provider: { type: ProviderType; id: string; name: string | null };
  startsAt: string;
  endsAt: string;
  amount: string;
  currency: string;
  status: BookingStatus;
  bookedAt: string;
}

/**
 * A stand-in port: it answers with the rows it was given and remembers every
 * filter it was handed, so a test can check what reached it.
 */
class StandInPort {
  readonly calls: AdminBookingFilter[] = [];
  rows: AdminBookingRow[] = [];
  total = 0;

  listForAdmin(filter: AdminBookingFilter): Promise<AdminBookingList> {
    this.calls.push(filter);
    return Promise.resolve({
      rows: this.rows.slice(0, filter.limit),
      total: this.total,
    });
  }
}

describe('Admin booking list (ACC-17, e2e)', () => {
  let app: INestApplication<App>;
  const userIds: string[] = [];
  let admin: SignedInUser;
  let traveller: SignedInUser;

  const flightPort = new StandInPort();
  const hotelPort = new StandInPort();

  function list(query: string, user: SignedInUser = admin) {
    return request(app.getHttpServer())
      .get(`${BOOKINGS}${query}`)
      .set('Cookie', user.cookie);
  }

  function flightRow(
    overrides: Partial<AdminBookingRow> = {},
  ): AdminBookingRow {
    return {
      bookingId: new Types.ObjectId().toString(),
      bookingType: BookingType.FLIGHT,
      bookingReference: FLIGHT_REFERENCE,
      userId: traveller.userId,
      providerType: ProviderType.AIRLINE,
      providerId: AIRLINE_ID,
      providerName: 'KD Airways',
      startsAt: new Date('2099-02-10T06:30:00.000Z'),
      endsAt: new Date('2099-02-10T10:30:00.000Z'),
      totalAmount: '420.00',
      currency: 'USD',
      status: BookingStatus.CONFIRMED,
      createdAt: new Date('2026-11-19T09:00:00.000Z'),
      ...overrides,
    };
  }

  function hotelRow(overrides: Partial<AdminBookingRow> = {}): AdminBookingRow {
    return {
      bookingId: new Types.ObjectId().toString(),
      bookingType: BookingType.HOTEL,
      bookingReference: HOTEL_REFERENCE,
      userId: traveller.userId,
      providerType: ProviderType.HOTEL,
      providerId: HOTEL_ID,
      providerName: 'Nile View Hotel',
      startsAt: new Date('2099-06-01T00:00:00.000Z'),
      endsAt: new Date('2099-06-03T00:00:00.000Z'),
      totalAmount: '300.00',
      currency: 'USD',
      status: BookingStatus.CONFIRMED,
      createdAt: new Date('2026-11-19T08:00:00.000Z'),
      ...overrides,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FLIGHT_BOOKINGS_PORT)
      .useValue(flightPort)
      .overrideProvider(HOTEL_BOOKINGS_PORT)
      .useValue(hotelPort)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    admin = await createSignedInUser(app, {
      role: Role.ADMIN,
      label: 'acc17-admin',
    });
    traveller = await createSignedInUser(app, { label: 'acc17-user' });
    userIds.push(admin.userId, traveller.userId);
  }, CONNECT_TIMEOUT_MS);

  // This suite writes no booking of its own: the two accounts are all there is
  // to clean up.
  afterAll(async () => {
    if (app) {
      await deleteTestUsers(app, userIds);
      await app.close();
    }
  }, CONNECT_TIMEOUT_MS);

  beforeEach(() => {
    for (const port of [flightPort, hotelPort]) {
      port.calls.length = 0;
      port.rows = [];
      port.total = 0;
    }
  });

  describe('who may read the list (ACC-11, ACC-17)', () => {
    it('rejects an anonymous request (401)', async () => {
      const res = await request(app.getHttpServer()).get(BOOKINGS).expect(401);

      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    // The owner-only rule on the traveller's own lists stays absolute: seeing
    // other people's bookings happens here and nowhere else.
    it('rejects a signed-in traveller (403)', async () => {
      const res = await list('', traveller).expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
      expect(flightPort.calls).toHaveLength(0);
    });
  });

  describe('the rows', () => {
    it('returns the documented shape for a flight booking', async () => {
      const row = flightRow();
      flightPort.rows = [row];
      flightPort.total = 1;

      const res = await list('').expect(200);

      expect(res.body.meta.pageSize).toBe(10);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toEqual({
        id: row.bookingId,
        type: BookingType.FLIGHT,
        reference: FLIGHT_REFERENCE,
        // Resolved from the real users collection, not from the port.
        user: {
          id: traveller.userId,
          name: 'C2 Test Account',
          email: traveller.email,
        },
        provider: {
          type: ProviderType.AIRLINE,
          id: AIRLINE_ID,
          name: 'KD Airways',
        },
        startsAt: '2099-02-10T06:30:00.000Z',
        endsAt: '2099-02-10T10:30:00.000Z',
        amount: '420.00',
        currency: 'USD',
        status: BookingStatus.CONFIRMED,
        bookedAt: '2026-11-19T09:00:00.000Z',
      });
    });

    it('returns the same shape for a hotel reservation', async () => {
      const row = hotelRow();
      hotelPort.rows = [row];
      hotelPort.total = 1;

      const res = await list('').expect(200);

      expect(res.body.items[0]).toMatchObject({
        id: row.bookingId,
        type: BookingType.HOTEL,
        reference: HOTEL_REFERENCE,
        provider: {
          type: ProviderType.HOTEL,
          id: HOTEL_ID,
          name: 'Nile View Hotel',
        },
        startsAt: '2099-06-01T00:00:00.000Z',
        endsAt: '2099-06-03T00:00:00.000Z',
        amount: '300.00',
        status: BookingStatus.CONFIRMED,
      });
    });

    // The whole point of the merged list: two collections, one page, in order.
    it('merges both modules newest first and adds up the counts', async () => {
      flightPort.rows = [
        flightRow({ createdAt: new Date('2026-11-19T11:00:00.000Z') }),
        flightRow({ createdAt: new Date('2026-11-19T09:00:00.000Z') }),
      ];
      flightPort.total = 7;
      hotelPort.rows = [
        hotelRow({ createdAt: new Date('2026-11-19T10:00:00.000Z') }),
        hotelRow({ createdAt: new Date('2026-11-19T08:00:00.000Z') }),
      ];
      hotelPort.total = 5;

      const res = await list('').expect(200);

      expect((res.body.items as BookingRow[]).map((row) => row.type)).toEqual([
        BookingType.FLIGHT,
        BookingType.HOTEL,
        BookingType.FLIGHT,
        BookingType.HOTEL,
      ]);
      expect(res.body.meta.totalItems).toBe(12);
    });

    it('never carries passenger or guest details', async () => {
      flightPort.rows = [flightRow()];
      flightPort.total = 1;

      const res = await list('').expect(200);

      for (const field of [
        'passengers',
        'segments',
        'baggage',
        'roomsSnapshot',
      ]) {
        expect(res.body.items[0]).not.toHaveProperty(field);
      }
    });

    // Money is Decimal128 in both collections; a row never carries a float.
    it('returns the amount as a string with two decimals', async () => {
      flightPort.rows = [flightRow({ totalAmount: '1999.00' })];
      flightPort.total = 1;

      const res = await list('').expect(200);

      expect(res.body.items[0].amount).toBe('1999.00');
    });

    // A booking outlives the account that made it, so the row still lists.
    it('keeps a row whose account has gone, without a name or an address', async () => {
      flightPort.rows = [
        flightRow({ userId: new Types.ObjectId().toString() }),
      ];
      flightPort.total = 1;

      const res = await list('').expect(200);

      expect(res.body.items[0].user).toMatchObject({
        name: null,
        email: null,
      });
    });
  });

  describe('what reaches the booking modules', () => {
    it('hands on every filter, with the days as instants', async () => {
      await list(
        '?status=CONFIRMED&from=2026-11-01&to=2026-11-30&reference=k7m2qx',
      ).expect(200);

      expect(flightPort.calls).toHaveLength(1);
      expect(flightPort.calls[0]).toEqual({
        status: BookingStatus.CONFIRMED,
        createdFrom: new Date('2026-11-01T00:00:00.000Z'),
        // Both ends name a whole UTC day, so the range runs to the start of
        // the day after `to`.
        createdTo: new Date('2026-12-01T00:00:00.000Z'),
        reference: 'K7M2QX',
        limit: 10,
      });
      expect(hotelPort.calls[0]).toEqual(flightPort.calls[0]);
    });

    it('asks only the module that owns the type', async () => {
      await list(`?type=${BookingType.HOTEL}`).expect(200);

      expect(flightPort.calls).toHaveLength(0);
      expect(hotelPort.calls).toHaveLength(1);
    });

    // Page n needs the newest n x 10 rows of each module, because they can all
    // come from one of them.
    it('asks for enough rows to cover the page asked for', async () => {
      hotelPort.rows = Array.from({ length: 20 }, (_, i) =>
        hotelRow({
          createdAt: new Date(Date.UTC(2026, 10, 19, 12, 0, 0) - i * 60_000),
        }),
      );
      hotelPort.total = 20;

      const res = await list('?page=2').expect(200);

      expect(hotelPort.calls[0].limit).toBe(20);
      expect(res.body.items).toHaveLength(10);
      expect(res.body.items[0].bookedAt).toBe(
        hotelPort.rows[10].createdAt.toISOString(),
      );
      expect(res.body.meta).toMatchObject({
        page: 2,
        totalItems: 20,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });

    // listForAdmin is optional on the port: a module that has not implemented
    // it answers nothing here rather than making the list fail.
    it('leaves out a module whose port cannot list yet, with no 501', async () => {
      const listing = flightPort.listForAdmin.bind(flightPort);
      delete (flightPort as Partial<StandInPort>).listForAdmin;
      hotelPort.rows = [hotelRow()];
      hotelPort.total = 1;

      try {
        const both = await list('').expect(200);
        expect(both.body.meta.totalItems).toBe(1);
        expect(
          (both.body.items as BookingRow[]).every(
            (row) => row.type === BookingType.HOTEL,
          ),
        ).toBe(true);

        const flightsOnly = await list(`?type=${BookingType.FLIGHT}`).expect(
          200,
        );
        expect(flightsOnly.body.items).toEqual([]);
        expect(flightsOnly.body.meta.totalItems).toBe(0);
      } finally {
        (flightPort as StandInPort).listForAdmin = listing;
      }
    });
  });

  describe('bad requests', () => {
    it.each([
      ['type=CAR', 'type'],
      ['status=DRAFT', 'status'],
      ['from=2026-13-01', 'from'],
      ['to=01-11-2026', 'to'],
      ['reference=.*', 'reference'],
      ['page=0', 'page'],
      ['limit=50', 'limit'],
    ])('rejects %s with a field error', async (query, field) => {
      const res = await list(`?${query}`).expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe(field);
      // Nothing reached a booking module: the request never got that far.
      expect(flightPort.calls).toHaveLength(0);
    });

    it('rejects a range that ends before it starts', async () => {
      const res = await list('?from=2026-11-30&to=2026-11-01').expect(400);

      expect(res.body.code).toBe('INVALID_DATE_RANGE');
      expect(flightPort.calls).toHaveLength(0);
    });
  });
});
