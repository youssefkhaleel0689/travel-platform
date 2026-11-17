// HTL-18: real-database test for concurrent room holds. Writes to the shared
// database; creates its own hotel/rooms/availability/bookings/user and deletes
// exactly those documents in afterAll. Needs MONGODB_URI and JWT_SECRET in .env.
process.env.B2_DISABLE_WORKER = 'true';

import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Session } from './../src/auth/sessions/session.schema';
import { User } from './../src/auth/schemas/user.schema';
import { Availability, AvailabilityStatus } from './../src/hotels/availability/schemas/availability.schema';
import {
  GuestType,
  HotelBooking,
  HotelBookingStatus,
} from './../src/hotels/bookings/schemas/hotel-booking.schema';
import { Hotel, HotelStatus } from './../src/hotels/schemas/hotel.schema';
import { Room } from './../src/hotels/rooms/schemas/room.schema';

const CONNECT_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000;
const LAST_FREE_NIGHT = { checkInDate: '2099-06-01', checkOutDate: '2099-06-02' };
const MULTI_ROOM_NIGHT = { checkInDate: '2099-07-01', checkOutDate: '2099-07-02' };

function accessTokenCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw)
    ? raw.filter((c): c is string => typeof c === 'string')
    : [];
  const cookie = cookies.find((c) => c.startsWith('access_token='));
  if (!cookie) throw new Error('the response set no access_token cookie');
  return cookie.split(';')[0];
}

describe('Hotel room holds (HTL-18, e2e, shared database)', () => {
  let app: INestApplication;
  let connection: Connection;
  let hotelModel: Model<Hotel>;
  let roomModel: Model<Room>;
  let availabilityModel: Model<Availability>;
  let bookingModel: Model<HotelBooking>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let cookie: string;
  let userId: Types.ObjectId;
  let hotelId: Types.ObjectId;
  let room1Id: Types.ObjectId;
  let room2Id: Types.ObjectId;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    hotelModel = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    roomModel = app.get<Model<Room>>(getModelToken(Room.name));
    availabilityModel = app.get<Model<Availability>>(
      getModelToken(Availability.name),
    );
    bookingModel = app.get<Model<HotelBooking>>(
      getModelToken(HotelBooking.name),
    );
    userModel = app.get<Model<User>>(getModelToken(User.name));
    sessionModel = app.get<Model<Session>>(getModelToken(Session.name));

    const email = `e2e-hotel-hold-${Date.now()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Hold Tester', email, password: 'HoldTest123', acceptTerms: true })
      .expect(201);
    cookie = accessTokenCookie(registered);
    userId = new Types.ObjectId((registered.body as { id: string }).id);

    const stamp = Date.now();
    const hotel = await hotelModel.create({
      name: `E2E Hold Hotel ${stamp}`,
      address: 'Test Street 1',
      cityId: 'cairo',
      countryId: 'EG',
      starClass: 4,
      status: HotelStatus.ACTIVE,
      createdBy: userId,
    });
    hotelId = hotel._id;

    const rooms = await roomModel.create([
      {
        hotelId,
        roomNumber: `E2E-${stamp}-1`,
        name: `E2E Room 1 ${stamp}`,
        type: 'DOUBLE',
        beds: 1,
        maxOccupancy: 2,
        pricePerNight: Types.Decimal128.fromString('100.00'),
      },
      {
        hotelId,
        roomNumber: `E2E-${stamp}-2`,
        name: `E2E Room 2 ${stamp}`,
        type: 'DOUBLE',
        beds: 1,
        maxOccupancy: 2,
        pricePerNight: Types.Decimal128.fromString('100.00'),
      },
    ]);
    [room1Id, room2Id] = rooms.map((r) => r._id);

    await availabilityModel.create([
      {
        hotelId,
        roomId: room1Id,
        startDate: new Date('2099-01-01T00:00:00Z'),
        endDate: new Date('2099-12-31T00:00:00Z'),
        status: AvailabilityStatus.AVAILABLE,
      },
      {
        hotelId,
        roomId: room2Id,
        startDate: new Date('2099-01-01T00:00:00Z'),
        endDate: new Date('2099-12-31T00:00:00Z'),
        status: AvailabilityStatus.AVAILABLE,
      },
    ]);
  }, CONNECT_TIMEOUT_MS * 2);

  afterAll(async () => {
    if (bookingModel && hotelId) {
      await bookingModel.deleteMany({ hotelId }).exec();
    }
    if (availabilityModel && hotelId) {
      await availabilityModel.deleteMany({ hotelId }).exec();
    }
    if (roomModel && hotelId) {
      await roomModel.deleteMany({ hotelId }).exec();
    }
    if (hotelModel && hotelId) {
      await hotelModel.deleteOne({ _id: hotelId }).exec();
    }
    if (sessionModel && userId) {
      await sessionModel.deleteMany({ userId }).exec();
    }
    if (userModel && userId) {
      await userModel.deleteOne({ _id: userId }).exec();
    }
    if (app) await app.close();
    else if (connection) await connection.close();
  }, CONNECT_TIMEOUT_MS);

  function holdBody(roomIds: Types.ObjectId[], night: typeof LAST_FREE_NIGHT) {
    return {
      hotelId: String(hotelId),
      ...night,
      rooms: roomIds.map((roomId) => ({
        roomId: String(roomId),
        assignedGuests: [{ type: GuestType.ADULT, fullName: 'Hold Tester', age: 30 }],
      })),
    };
  }

  function postHold(roomIds: Types.ObjectId[], night: typeof LAST_FREE_NIGHT) {
    return request(app.getHttpServer())
      .post('/api/hotel-bookings')
      .set('Cookie', cookie)
      .send(holdBody(roomIds, night));
  }

  it(
    'gives the last free room to exactly one of two parallel holds',
    async () => {
      const [a, b] = await Promise.all([
        postHold([room1Id], LAST_FREE_NIGHT),
        postHold([room1Id], LAST_FREE_NIGHT),
      ]);
      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([201, 409]);
      const rejected = [a, b].find((r) => r.status === 409);
      expect(rejected?.body.code).toBe('ROOM_UNAVAILABLE');

      const holds = await bookingModel
        .find({
          hotelId,
          status: HotelBookingStatus.PENDING_PAYMENT,
          'roomsSnapshot.roomId': room1Id,
          checkInDate: new Date(`${LAST_FREE_NIGHT.checkInDate}T00:00:00Z`),
        })
        .exec();
      expect(holds).toHaveLength(1);

      await bookingModel.deleteMany({ hotelId }).exec();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'holds nothing on room 1 when room 2 is already taken (multi-room hold)',
    async () => {
      // A confirmed booking consumes inventory on room 2 for the second night.
      await bookingModel.create({
        userId,
        hotelId,
        checkInDate: new Date(`${MULTI_ROOM_NIGHT.checkInDate}T00:00:00Z`),
        checkOutDate: new Date(`${MULTI_ROOM_NIGHT.checkOutDate}T00:00:00Z`),
        roomsSnapshot: [
          {
            roomId: room2Id,
            roomNumberSnapshot: 'E2E-2',
            roomNameSnapshot: 'E2E Room 2',
            roomTypeSnapshot: 'DOUBLE',
            bedsSnapshot: 1,
            maxOccupancySnapshot: 2,
            pricePerNightSnapshot: Types.Decimal128.fromString('100.00'),
            assignedGuests: [{ type: GuestType.ADULT, fullName: 'Other Guest', age: 30 }],
            nights: 1,
            lineTotal: Types.Decimal128.fromString('100.00'),
          },
        ],
        adultCount: 1,
        childCount: 0,
        totalPrice: Types.Decimal128.fromString('100.00'),
        currency: 'USD',
        status: HotelBookingStatus.CONFIRMED,
        bookingReference: `E2E-${new Types.ObjectId().toString().slice(-8).toUpperCase()}`,
        policySnapshot: {
          policyVersion: 0,
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [],
        },
      });

      const response = await postHold(
        [room1Id, room2Id],
        MULTI_ROOM_NIGHT,
      ).expect(409);
      expect(response.body.code).toBe('ROOM_UNAVAILABLE');

      const leakedHolds = await bookingModel
        .find({
          hotelId,
          status: HotelBookingStatus.PENDING_PAYMENT,
          'roomsSnapshot.roomId': { $in: [room1Id, room2Id] },
          checkInDate: new Date(`${MULTI_ROOM_NIGHT.checkInDate}T00:00:00Z`),
        })
        .exec();
      expect(leakedHolds).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );
});
