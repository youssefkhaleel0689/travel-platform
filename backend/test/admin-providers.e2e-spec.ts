// ACC-15 (provider half) against the real app and the shared database: an admin
// deactivates and reactivates a hotel and an airline.
//
// This suite WRITES, and afterAll deletes exactly what it wrote, by _id:
//  - an admin and a plain user (auth-test-helper, test_c2_ emails), and one
//    moderator per provider created through POST /api/admin/moderators, plus
//    their two assignment rows;
//  - one airline "test_c2_acc15 airline" with an unused two-digit IATA code and
//    one CAI -> DXB flight in February 2099;
//  - one hotel "test_c2_acc15 hotel" in Cairo with one room at 4321.57 a night,
//    AVAILABLE for the searched stay (hotel search needs an availability range);
//  - one CONFIRMED flight booking and one CONFIRMED hotel booking of the plain
//    user, inserted with the driver and holding only the fields ACC-15 reads
//    (they exist to be notified about and to prove they stay CONFIRMED);
//  - the audit rows of the test admin and of the two providers, and the
//    notifications of the test accounts.
// Run `npm run seed` first: it uses the seeded airports CAI and DXB and the
// city cairo.
import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import {
  Availability,
  AvailabilityStatus,
} from './../src/availability/schemas/availability.schema';
import { Role } from './../src/common/auth/auth.enums';
import { AirlineModeratorAssignment } from './../src/flights/schemas/airline-moderator-assignment.schema';
import {
  Airline,
  AirlineStatus,
} from './../src/flights/schemas/airline.schema';
import {
  CabinCategory,
  Flight,
  FlightStatus,
} from './../src/flights/schemas/flight.schema';
import { HotelModeratorAssignment } from './../src/hotels/schemas/hotel-moderator-assignment.schema';
import { Hotel, HotelStatus } from './../src/hotels/schemas/hotel.schema';
import { Room } from './../src/rooms/schemas/room.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
  testEmail,
} from './support/auth-test-helper';

// A Nest app against Atlas, three accounts with a bcrypt hash each and the test
// providers: as heavy as admin-moderators.e2e-spec.ts, so the same allowance.
const CONNECT_TIMEOUT_MS = 180_000;

const PROVIDERS = '/api/admin/providers';
const FLIGHT_DATE = '2099-02-17';
const CHECK_IN = '2099-03-10';
const CHECK_OUT = '2099-03-12';
// Unusual enough that no teammate's room in Cairo costs exactly this.
const ROOM_PRICE = '4321.57';

interface FlightSearchBody {
  outbound: { items: { airline: { id: string } }[] } | null;
}

interface HotelSearchBody {
  items: { hotelId: string }[];
}

interface AuditLogsBody {
  items: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }[];
}

describe('Admin deactivates and reactivates a provider (ACC-15) (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let airlineModel: Model<Airline>;
  let flightModel: Model<Flight>;
  let hotelModel: Model<Hotel>;
  let roomModel: Model<Room>;
  let availabilityModel: Model<Availability>;
  let airlineAssignmentModel: Model<AirlineModeratorAssignment>;
  let hotelAssignmentModel: Model<HotelModeratorAssignment>;

  let admin: SignedInUser;
  let traveller: SignedInUser;
  let airlineModeratorId: string;
  let hotelModeratorId: string;
  let airlineId: string;
  let hotelId: string;
  let flightBookingId: Types.ObjectId | undefined;
  let hotelBookingId: Types.ObjectId | undefined;

  const createdUserIds: string[] = [];
  const airlineIds: Types.ObjectId[] = [];
  const flightIds: Types.ObjectId[] = [];
  const hotelIds: Types.ObjectId[] = [];
  const roomIds: Types.ObjectId[] = [];
  const availabilityIds: Types.ObjectId[] = [];

  async function signIn(
    options: Parameters<typeof createSignedInUser>[1] = {},
  ): Promise<SignedInUser> {
    const user = await createSignedInUser(app, options);
    createdUserIds.push(user.userId);
    return user;
  }

  // Two-digit codes are valid (FLT-01) but no real airline uses them.
  async function unusedIataCode(): Promise<string> {
    for (let n = 0; n < 100; n++) {
      const code = String(n).padStart(2, '0');
      if (!(await airlineModel.exists({ iataCode: code }).exec())) {
        return code;
      }
    }
    throw new Error('No unused two-digit IATA code for the test airline');
  }

  /** ACC-13, through the real endpoint: a moderator linked to one provider. */
  async function createModerator(
    role: Role.AIRLINE_MODERATOR | Role.HOTEL_MODERATOR,
    provider: { airlineId: string } | { hotelId: string },
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/admin/moderators')
      .set('Cookie', admin.cookie)
      .send({
        name: 'C2 Test Moderator',
        email: testEmail('acc15_mod'),
        role,
        ...provider,
      })
      .expect(201);
    const id = res.body.account.id as string;
    createdUserIds.push(id);
    return id;
  }

  function patch(path: string, cookie?: string) {
    const req = request(app.getHttpServer()).patch(`${PROVIDERS}${path}`);
    return cookie ? req.set('Cookie', cookie) : req;
  }

  async function flightSearchAirlineIds(): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/api/flights/search')
      .query({
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureDate: FLIGHT_DATE,
      })
      .expect(200);
    const body = res.body as FlightSearchBody;
    return (body.outbound?.items ?? []).map((item) => item.airline.id);
  }

  async function hotelSearchIds(): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/api/hotels/search')
      .query({
        cityId: 'cairo',
        checkInDate: CHECK_IN,
        checkOutDate: CHECK_OUT,
        guestCount: 1,
        minPricePerNight: ROOM_PRICE,
        maxPricePerNight: ROOM_PRICE,
      })
      .expect(200);
    return (res.body as HotelSearchBody).items.map((item) =>
      String(item.hotelId),
    );
  }

  async function notificationsOf(userId: string) {
    return connection
      .collection('notifications')
      .find({ userId: new Types.ObjectId(userId) })
      .toArray();
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    airlineModel = app.get<Model<Airline>>(getModelToken(Airline.name));
    flightModel = app.get<Model<Flight>>(getModelToken(Flight.name));
    hotelModel = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    roomModel = app.get<Model<Room>>(getModelToken(Room.name));
    availabilityModel = app.get<Model<Availability>>(
      getModelToken(Availability.name),
    );
    airlineAssignmentModel = app.get<Model<AirlineModeratorAssignment>>(
      getModelToken(AirlineModeratorAssignment.name),
    );
    hotelAssignmentModel = app.get<Model<HotelModeratorAssignment>>(
      getModelToken(HotelModeratorAssignment.name),
    );

    admin = await signIn({ role: Role.ADMIN, label: 'acc15_admin' });
    traveller = await signIn({ label: 'acc15_traveller' });

    const airline = await airlineModel.create({
      name: 'test_c2_acc15 airline',
      iataCode: await unusedIataCode(),
      status: AirlineStatus.ACTIVE,
      createdBy: new Types.ObjectId(admin.userId),
    });
    airlineIds.push(airline._id);
    airlineId = airline._id.toString();

    // CAI is on UTC+2 and DXB on UTC+4 in February.
    const flight = await flightModel.create({
      airlineId: airline._id,
      flightNumber: 'C2151',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: `${FLIGHT_DATE}T08:00`,
      arrivalLocalInput: `${FLIGHT_DATE}T13:00`,
      departureAtUtc: new Date(`${FLIGHT_DATE}T06:00:00Z`),
      arrivalAtUtc: new Date(`${FLIGHT_DATE}T09:00:00Z`),
      departureDateKey: FLIGHT_DATE,
      status: FlightStatus.SCHEDULED,
      cabinInventory: [
        {
          category: CabinCategory.ECONOMY,
          totalSeats: 100,
          bookedSeats: 0,
          heldSeats: 0,
          price: Types.Decimal128.fromString('300.00'),
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
      ],
    });
    flightIds.push(flight._id);

    const hotel = await hotelModel.create({
      name: 'test_c2_acc15 hotel',
      address: '1 Test Street',
      cityId: 'cairo',
      countryId: 'EG',
      starClass: 3,
      createdBy: new Types.ObjectId(admin.userId),
    });
    hotelIds.push(hotel._id);
    hotelId = hotel._id.toString();

    const room = await roomModel.create({
      hotelId: hotel._id,
      roomNumber: 'ACC15-1',
      name: 'test_c2_acc15 room',
      type: 'DOUBLE',
      beds: 1,
      maxOccupancy: 2,
      pricePerNight: Types.Decimal128.fromString(ROOM_PRICE),
    });
    roomIds.push(room._id);

    const availability = await availabilityModel.create({
      hotelId: hotel._id,
      roomId: room._id,
      startDate: new Date(`${CHECK_IN}T00:00:00Z`),
      endDate: new Date(`${CHECK_OUT}T00:00:00Z`),
      status: AvailabilityStatus.AVAILABLE,
      createdBy: new Types.ObjectId(admin.userId),
    });
    availabilityIds.push(availability._id);

    airlineModeratorId = await createModerator(Role.AIRLINE_MODERATOR, {
      airlineId,
    });
    hotelModeratorId = await createModerator(Role.HOTEL_MODERATOR, {
      hotelId,
    });

    // Upcoming CONFIRMED bookings of the traveller, with only what ACC-15 reads.
    const flightBooking = await connection
      .collection('flightBookings')
      .insertOne({
        userId: new Types.ObjectId(traveller.userId),
        tripType: 'ONE_WAY',
        status: 'CONFIRMED',
        segments: [
          {
            flightId: flight._id,
            airlineId: airline._id,
            flightNumber: 'C2151',
            departureAirportId: 'CAI',
            arrivalAirportId: 'DXB',
            departureAtUtc: new Date(`${FLIGHT_DATE}T06:00:00Z`),
            arrivalAtUtc: new Date(`${FLIGHT_DATE}T09:00:00Z`),
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    flightBookingId = flightBooking.insertedId;

    const hotelBooking = await connection
      .collection('hotelBookings')
      .insertOne({
        userId: new Types.ObjectId(traveller.userId),
        hotelId: hotel._id,
        status: 'CONFIRMED',
        checkInDate: new Date(`${CHECK_IN}T00:00:00Z`),
        checkOutDate: new Date(`${CHECK_OUT}T00:00:00Z`),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    hotelBookingId = hotelBooking.insertedId;
  }, CONNECT_TIMEOUT_MS);

  // Deletes only what this suite created or caused, then closes the app.
  afterAll(async () => {
    if (flightBookingId) {
      await connection
        .collection('flightBookings')
        .deleteOne({ _id: flightBookingId });
    }
    if (hotelBookingId) {
      await connection
        .collection('hotelBookings')
        .deleteOne({ _id: hotelBookingId });
    }
    await availabilityModel
      .deleteMany({ _id: { $in: availabilityIds } })
      .exec();
    await roomModel.deleteMany({ _id: { $in: roomIds } }).exec();
    await flightModel.deleteMany({ _id: { $in: flightIds } }).exec();
    await hotelModel.deleteMany({ _id: { $in: hotelIds } }).exec();
    await airlineModel.deleteMany({ _id: { $in: airlineIds } }).exec();

    const userObjectIds = createdUserIds.map((id) => new Types.ObjectId(id));
    if (userObjectIds.length > 0) {
      await airlineAssignmentModel
        .deleteMany({ moderatorId: { $in: userObjectIds } })
        .exec();
      await hotelAssignmentModel
        .deleteMany({ moderatorId: { $in: userObjectIds } })
        .exec();
      await connection
        .collection('notifications')
        .deleteMany({ userId: { $in: userObjectIds } });
    }
    // Rows about our providers, and every row our test accounts wrote (ACC-13).
    const providerIds = [...airlineIds, ...hotelIds];
    if (providerIds.length > 0) {
      await connection
        .collection('auditLogs')
        .deleteMany({ entityId: { $in: providerIds } });
    }
    if (userObjectIds.length > 0) {
      await connection
        .collection('auditLogs')
        .deleteMany({ actorId: { $in: userObjectIds } });
    }

    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  describe('who may call it', () => {
    it.each(['deactivate', 'reactivate'])(
      '%s rejects a guest (401)',
      async (action) => {
        const res = await patch(`/airline/${airlineId}/${action}`).expect(401);
        expect(res.body.code).toBe('UNAUTHENTICATED');
      },
    );

    it.each(['deactivate', 'reactivate'])(
      '%s rejects a non-admin account (403)',
      async (action) => {
        const res = await patch(
          `/hotel/${hotelId}/${action}`,
          traveller.cookie,
        ).expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
      },
    );
  });

  describe('bad paths', () => {
    it('rejects a type other than hotel or airline (400 with a field error)', async () => {
      const res = await patch(
        `/train/${airlineId}/deactivate`,
        admin.cookie,
      ).expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors).toEqual([
        { field: 'type', messages: ['type must be hotel or airline'] },
      ]);
    });

    it.each([
      ['airline', 'AIRLINE_NOT_FOUND'],
      ['hotel', 'HOTEL_NOT_FOUND'],
    ])('answers 404 for a %s that does not exist', async (type, code) => {
      const res = await patch(
        `/${type}/${new Types.ObjectId().toString()}/deactivate`,
        admin.cookie,
      ).expect(404);
      expect(res.body.code).toBe(code);
    });

    it('answers the same 404 for a malformed id', async () => {
      const res = await patch(
        '/hotel/not-an-id/deactivate',
        admin.cookie,
      ).expect(404);
      expect(res.body.code).toBe('HOTEL_NOT_FOUND');
    });

    it('does not take the airline id for a hotel (404)', async () => {
      const res = await patch(
        `/hotel/${airlineId}/deactivate`,
        admin.cookie,
      ).expect(404);
      expect(res.body.code).toBe('HOTEL_NOT_FOUND');
    });
  });

  describe('an airline', () => {
    it('is in flight search while ACTIVE', async () => {
      expect(await flightSearchAirlineIds()).toContain(airlineId);
    });

    it('deactivates (200), notifies its moderator and the traveller, and keeps the booking CONFIRMED', async () => {
      const res = await patch(
        `/airline/${airlineId}/deactivate`,
        admin.cookie,
      ).expect(200);

      expect(res.body).toEqual({
        type: 'airline',
        id: airlineId,
        name: 'test_c2_acc15 airline',
        status: AirlineStatus.DEACTIVATED,
        deactivatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        notifiedUsers: 2,
      });

      const moderatorNotices = await notificationsOf(airlineModeratorId);
      expect(moderatorNotices).toEqual([
        expect.objectContaining({
          type: 'PROVIDER_SUSPENDED',
          title: 'Airline deactivated',
          resourceType: 'AIRLINE',
          resourceId: airlineId,
        }),
      ]);

      const travellerNotices = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Cookie', traveller.cookie)
        .expect(200);
      expect(travellerNotices.body.items).toContainEqual(
        expect.objectContaining({
          type: 'PROVIDER_SUSPENDED',
          title: 'Airline deactivated',
          message: expect.stringContaining(
            'Your confirmed booking remains valid.',
          ),
        }),
      );

      const booking = await connection
        .collection('flightBookings')
        .findOne({ _id: flightBookingId });
      expect(booking?.status).toBe('CONFIRMED');
    });

    it('is no longer in flight search', async () => {
      expect(await flightSearchAirlineIds()).not.toContain(airlineId);
    });

    it('cannot be deactivated again (409)', async () => {
      const res = await patch(
        `/airline/${airlineId}/deactivate`,
        admin.cookie,
      ).expect(409);
      expect(res.body.code).toBe('AIRLINE_ALREADY_DEACTIVATED');
    });

    it('reactivates (200) and is back in flight search', async () => {
      const res = await patch(
        `/airline/${airlineId}/reactivate`,
        admin.cookie,
      ).expect(200);

      expect(res.body).toMatchObject({
        type: 'airline',
        id: airlineId,
        status: AirlineStatus.ACTIVE,
        deactivatedAt: null,
        notifiedUsers: 2,
      });
      expect(await flightSearchAirlineIds()).toContain(airlineId);
    });

    it('cannot be reactivated again (409)', async () => {
      const res = await patch(
        `/airline/${airlineId}/reactivate`,
        admin.cookie,
      ).expect(409);
      expect(res.body.code).toBe('AIRLINE_ALREADY_ACTIVE');
    });

    it('shows both changes in the audit log', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .query({ entityId: airlineId })
        .set('Cookie', admin.cookie)
        .expect(200);

      const rows = (res.body as AuditLogsBody).items;
      expect(rows.map((row) => row.action).sort()).toEqual([
        'PROVIDER_DEACTIVATED',
        'PROVIDER_REACTIVATED',
      ]);
      expect(rows).toContainEqual(
        expect.objectContaining({
          actorId: admin.userId,
          action: 'PROVIDER_DEACTIVATED',
          entityType: 'AIRLINE',
          entityId: airlineId,
          before: { status: 'ACTIVE' },
          after: { status: 'DEACTIVATED' },
        }),
      );
    });
  });

  describe('a hotel', () => {
    it('is in hotel search while ACTIVE', async () => {
      expect(await hotelSearchIds()).toContain(hotelId);
    });

    it('deactivates (200), notifies its moderator and the traveller, and keeps the booking CONFIRMED', async () => {
      const res = await patch(
        `/hotel/${hotelId}/deactivate`,
        admin.cookie,
      ).expect(200);

      expect(res.body).toEqual({
        type: 'hotel',
        id: hotelId,
        name: 'test_c2_acc15 hotel',
        status: HotelStatus.DEACTIVATED,
        deactivatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        notifiedUsers: 2,
      });

      expect(await notificationsOf(hotelModeratorId)).toEqual([
        expect.objectContaining({
          type: 'PROVIDER_SUSPENDED',
          title: 'Hotel deactivated',
          resourceType: 'HOTEL',
          resourceId: hotelId,
        }),
      ]);

      const booking = await connection
        .collection('hotelBookings')
        .findOne({ _id: hotelBookingId });
      expect(booking?.status).toBe('CONFIRMED');
    });

    it('is no longer in hotel search', async () => {
      expect(await hotelSearchIds()).not.toContain(hotelId);
    });

    it('cannot be deactivated again (409)', async () => {
      const res = await patch(
        `/hotel/${hotelId}/deactivate`,
        admin.cookie,
      ).expect(409);
      expect(res.body.code).toBe('HOTEL_ALREADY_DEACTIVATED');
    });

    it('reactivates (200) and is back in hotel search', async () => {
      const res = await patch(
        `/hotel/${hotelId}/reactivate`,
        admin.cookie,
      ).expect(200);

      expect(res.body).toMatchObject({
        type: 'hotel',
        id: hotelId,
        status: HotelStatus.ACTIVE,
        deactivatedAt: null,
      });
      expect(await hotelSearchIds()).toContain(hotelId);
    });

    it('cannot be reactivated again (409)', async () => {
      const res = await patch(
        `/hotel/${hotelId}/reactivate`,
        admin.cookie,
      ).expect(409);
      expect(res.body.code).toBe('HOTEL_ALREADY_ACTIVE');
    });

    it('shows the deactivation in the audit log', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .query({ entityId: hotelId, action: 'PROVIDER_DEACTIVATED' })
        .set('Cookie', admin.cookie)
        .expect(200);

      expect((res.body as AuditLogsBody).items).toEqual([
        expect.objectContaining({
          actorId: admin.userId,
          entityType: 'HOTEL',
          entityId: hotelId,
          before: { status: 'ACTIVE' },
          after: { status: 'DEACTIVATED' },
        }),
      ]);
    });
  });
});
