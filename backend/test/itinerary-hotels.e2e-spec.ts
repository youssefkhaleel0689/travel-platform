// ITN-25 end to end against the shared database: hotel search from an itinerary's city
// group. This suite WRITES, and afterAll deletes exactly what it wrote, by _id:
//  - two test accounts (auth-test-helper, test_c2_ emails);
//  - their itineraries, created through the API;
//  - one hotel "test_c2_itn25 hotel" in Cairo with one active room at 3217.43 a night
//    and an AVAILABLE range covering the searched stay.
// Run `npm run seed` first: it uses the seeded cities cairo and dubai.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import {
  Availability,
  AvailabilityStatus,
} from './../src/availability/schemas/availability.schema';
import { Hotel } from './../src/hotels/schemas/hotel.schema';
import { Itinerary } from './../src/itineraries/schemas/itinerary.schema';
import { Room } from './../src/rooms/schemas/room.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;

// Days 1-2 in Cairo, day 3 in Dubai: group 1 is Cairo from 10 to 11 May 2099, so
// check-in is the 10th and check-out the 12th. Group 2 is Dubai; there is no group 3.
const START_DATE = '2099-05-10';
const CHECK_IN = '2099-05-10';
const CHECK_OUT = '2099-05-12';
// Unusual enough that no teammate's room in Cairo costs exactly this, so the filter
// keeps our hotel on the first page whatever else is in Cairo.
const ROOM_PRICE = '3217.43';

interface ItineraryHotelsBody {
  itineraryId: string;
  cityGroup: Record<string, unknown>;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  guestCount: number;
  roomCount: number;
  items: { hotelId: string; name: string; pricePerNight: string }[];
}

describe('Itinerary hotels, ITN-25 (e2e)', () => {
  let app: INestApplication<App>;
  let itineraryModel: Model<Itinerary>;
  let hotelModel: Model<Hotel>;
  let roomModel: Model<Room>;
  let availabilityModel: Model<Availability>;

  let owner: SignedInUser;
  let other: SignedInUser;
  let itineraryId: string;
  let hotelId: string;

  const createdUserIds: string[] = [];
  const itineraryIds: Types.ObjectId[] = [];
  const hotelIds: Types.ObjectId[] = [];
  const roomIds: Types.ObjectId[] = [];
  const availabilityIds: Types.ObjectId[] = [];

  const http = () => request(app.getHttpServer());

  /** An itinerary of the owner, made through the API, with one day per city. */
  async function createItinerary(
    startDate: string,
    cities: string[],
  ): Promise<string> {
    const created = await http()
      .post('/api/itineraries')
      .set('Cookie', owner.cookie)
      .send({ title: 'test_c2_itn25', countries: ['EG', 'AE'], startDate })
      .expect(201);
    const id = created.body.id as string;
    itineraryIds.push(new Types.ObjectId(id));
    for (const city of cities) {
      await http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', owner.cookie)
        .send({ city })
        .expect(201);
    }
    return id;
  }

  function searchHotels(
    id: string,
    query: Record<string, string | number>,
    cookie = owner.cookie,
  ) {
    return http()
      .get(`/api/itineraries/${id}/hotels`)
      .query(query)
      .set('Cookie', cookie);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    itineraryModel = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    hotelModel = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    roomModel = app.get<Model<Room>>(getModelToken(Room.name));
    availabilityModel = app.get<Model<Availability>>(
      getModelToken(Availability.name),
    );

    owner = await createSignedInUser(app, { label: 'itn25_owner' });
    other = await createSignedInUser(app, { label: 'itn25_other' });
    createdUserIds.push(owner.userId, other.userId);

    itineraryId = await createItinerary(START_DATE, [
      'cairo',
      'cairo',
      'dubai',
    ]);

    const hotel = await hotelModel.create({
      name: 'test_c2_itn25 hotel',
      address: '1 Test Street',
      cityId: 'cairo',
      countryId: 'EG',
      starClass: 3,
      createdBy: new Types.ObjectId(owner.userId),
    });
    hotelIds.push(hotel._id);
    hotelId = hotel._id.toString();

    const room = await roomModel.create({
      hotelId: hotel._id,
      roomNumber: 'ITN25-1',
      name: 'test_c2_itn25 room',
      type: 'DOUBLE',
      beds: 1,
      maxOccupancy: 2,
      pricePerNight: Types.Decimal128.fromString(ROOM_PRICE),
      isActive: true,
    });
    roomIds.push(room._id);

    const availability = await availabilityModel.create({
      hotelId: hotel._id,
      roomId: room._id,
      startDate: new Date(`${CHECK_IN}T00:00:00Z`),
      endDate: new Date(`${CHECK_OUT}T00:00:00Z`),
      status: AvailabilityStatus.AVAILABLE,
    });
    availabilityIds.push(availability._id);
  }, CONNECT_TIMEOUT_MS);

  // Deletes only what this suite created, by _id, then closes the app.
  afterAll(async () => {
    if (availabilityModel) {
      await availabilityModel
        .deleteMany({ _id: { $in: availabilityIds } })
        .exec();
      await roomModel.deleteMany({ _id: { $in: roomIds } }).exec();
      await hotelModel.deleteMany({ _id: { $in: hotelIds } }).exec();
      await itineraryModel.deleteMany({ _id: { $in: itineraryIds } }).exec();
    }
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it('lists the Cairo hotel for city group 1, with check-out the day after its last day', async () => {
    const res = await searchHotels(itineraryId, {
      cityGroup: 1,
      guestCount: 2,
      minPricePerNight: ROOM_PRICE,
      maxPricePerNight: ROOM_PRICE,
    }).expect(200);
    const body = res.body as ItineraryHotelsBody;

    expect(body.itineraryId).toBe(itineraryId);
    expect(body.cityGroup).toEqual({
      index: 1,
      city: 'cairo',
      fromDay: 1,
      toDay: 2,
      checkInDate: CHECK_IN,
      checkOutDate: CHECK_OUT,
    });
    expect(body.checkInDate).toBe(`${CHECK_IN}T00:00:00.000Z`);
    expect(body.checkOutDate).toBe(`${CHECK_OUT}T00:00:00.000Z`);
    expect(body.nights).toBe(2);
    expect(body.guestCount).toBe(2);
    expect(body.roomCount).toBe(1);
    expect(body.items).toContainEqual(
      expect.objectContaining({
        hotelId,
        name: 'test_c2_itn25 hotel',
        pricePerNight: ROOM_PRICE,
      }),
    );
  });

  it('does not list the Cairo hotel for group 2, which is in Dubai', async () => {
    const res = await searchHotels(itineraryId, {
      cityGroup: 2,
      guestCount: 1,
    }).expect(200);
    const body = res.body as ItineraryHotelsBody;

    expect(body.cityGroup).toMatchObject({
      city: 'dubai',
      fromDay: 3,
      toDay: 3,
    });
    expect(body.items.map((item) => item.hotelId)).not.toContain(hotelId);
  });

  it('answers 400 UNKNOWN_CITY_GROUP for group 3 of 2', async () => {
    const res = await searchHotels(itineraryId, {
      cityGroup: 3,
      guestCount: 1,
    }).expect(400);

    expect(res.body.code).toBe('UNKNOWN_CITY_GROUP');
    expect(res.body.message).toBe(
      'cityGroup must be between 1 and 2: this itinerary has 2 city groups',
    );
  });

  it("answers 404 for another user's itinerary", async () => {
    const res = await searchHotels(
      itineraryId,
      { cityGroup: 1, guestCount: 1 },
      other.cookie,
    ).expect(404);

    expect(res.body.code).toBe('ITINERARY_NOT_FOUND');
  });

  it('answers 400 VALIDATION_FAILED for guestCount 0', async () => {
    const res = await searchHotels(itineraryId, {
      cityGroup: 1,
      guestCount: 0,
    }).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([
      { field: 'guestCount', messages: ['guestCount must not be less than 1'] },
    ]);
  });

  it('answers 401 for a guest', async () => {
    await http()
      .get(`/api/itineraries/${itineraryId}/hotels`)
      .query({ cityGroup: 1, guestCount: 1 })
      .expect(401);
  });

  it('answers 409 ITINERARY_HAS_NO_DAYS for an itinerary without days', async () => {
    const empty = await createItinerary(START_DATE, []);

    const res = await searchHotels(empty, {
      cityGroup: 1,
      guestCount: 1,
    }).expect(409);

    expect(res.body.code).toBe('ITINERARY_HAS_NO_DAYS');
  });

  it("gives hotel search's own 400 for a group whose check-in has passed", async () => {
    const past = await createItinerary('2020-01-01', ['cairo']);

    const res = await searchHotels(past, {
      cityGroup: 1,
      guestCount: 1,
    }).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([
      { field: 'checkInDate', messages: ['checkInDate cannot be in the past'] },
    ]);
  });
});
