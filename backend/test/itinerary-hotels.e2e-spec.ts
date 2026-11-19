// GET /api/itineraries/:id/hotels (ITN-25) against the real app and the shared
// database. It writes only test_c2_ accounts made by the shared helper and their
// itineraries, and afterAll deletes exactly those. The stay dates are checked on
// what reaches hotel search (HTL-11); the hotels found are whatever the shared
// database has for the city (the demo hotels when npm run seed:hotels was run).
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { HotelSearchDto } from './../src/hotel-search/dto/hotel-search.dto';
import { HotelSearchService } from './../src/hotel-search/hotel-search.service';
import { Itinerary } from './../src/itineraries/schemas/itinerary.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

describe('Itinerary hotel search (e2e, ITN-25)', () => {
  let app: INestApplication<App>;
  let itineraryModel: Model<Itinerary>;
  let searchSpy: jest.SpyInstance;
  const createdUserIds: string[] = [];
  let owner: SignedInUser;
  let other: SignedInUser;
  // 10 March 2027: Paris on days 1-2, London on day 3.
  let itineraryId: string;
  let emptyItineraryId: string;

  const http = () => request(app.getHttpServer());
  const lastHotelQuery = () =>
    searchSpy.mock.calls[searchSpy.mock.calls.length - 1][0] as HotelSearchDto;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    itineraryModel = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    searchSpy = jest.spyOn(app.get(HotelSearchService), 'search');

    owner = await createSignedInUser(app, { label: 'itn_htl_owner' });
    other = await createSignedInUser(app, { label: 'itn_htl_other' });
    createdUserIds.push(owner.userId, other.userId);

    const created = await http()
      .post('/api/itineraries')
      .set('Cookie', owner.cookie)
      .send({
        title: 'E2E hotels',
        countries: ['FR', 'GB'],
        startDate: '2027-03-10',
      })
      .expect(201);
    itineraryId = created.body.id as string;
    for (const city of ['paris', 'paris', 'london']) {
      await http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ city })
        .expect(201);
    }
    const empty = await http()
      .post('/api/itineraries')
      .set('Cookie', owner.cookie)
      .send({ title: 'E2E empty', countries: ['FR'], startDate: '2027-03-10' })
      .expect(201);
    emptyItineraryId = empty.body.id as string;
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    if (itineraryModel && createdUserIds.length > 0) {
      await itineraryModel
        .deleteMany({
          userId: { $in: createdUserIds.map((id) => new Types.ObjectId(id)) },
        })
        .exec();
    }
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it('needs a login', async () => {
    await http()
      .get(`/api/itineraries/${itineraryId}/hotels?group=1&guestCount=2`)
      .expect(401);
  });

  it(
    "searches the first group's city and dates (check-out the day after its last day)",
    async () => {
      const res = await http()
        .get(`/api/itineraries/${itineraryId}/hotels?group=1&guestCount=2`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(res.body.cityGroup).toEqual({
        group: 1,
        city: 'paris',
        fromDay: 1,
        toDay: 2,
        checkInDate: '2027-03-10',
        checkOutDate: '2027-03-12',
      });
      expect(res.body.nights).toBe(2);
      expect(res.body.guestCount).toBe(2);
      expect(res.body.roomCount).toBe(1);
      expect(res.body.meta).toEqual(
        expect.objectContaining({ page: 1, pageSize: 10 }),
      );
      for (const hotel of res.body.items as { cityId: string }[]) {
        expect(hotel.cityId).toBe('paris');
      }
      // What reached hotel search (HTL-11): the group's city and stay.
      expect(lastHotelQuery()).toEqual(
        expect.objectContaining({
          cityId: 'paris',
          checkInDate: '2027-03-10',
          checkOutDate: '2027-03-12',
          guestCount: 2,
          roomCount: 1,
        }),
      );
    },
    SLOW_MS,
  );

  it(
    'searches the second group with the guests, rooms and filters entered',
    async () => {
      const res = await http()
        .get(
          `/api/itineraries/${itineraryId}/hotels?group=2&guestCount=3&roomCount=2&maxPricePerNight=500&sortBy=rating`,
        )
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(res.body.cityGroup).toEqual(
        expect.objectContaining({
          group: 2,
          city: 'london',
          checkInDate: '2027-03-12',
          checkOutDate: '2027-03-13',
        }),
      );
      expect(res.body.nights).toBe(1);
      expect(lastHotelQuery()).toEqual(
        expect.objectContaining({
          cityId: 'london',
          guestCount: 3,
          roomCount: 2,
          maxPricePerNight: '500',
          sortBy: 'rating',
        }),
      );
    },
    SLOW_MS,
  );

  it('validates the group and the guest count', async () => {
    await http()
      .get(`/api/itineraries/${itineraryId}/hotels?group=3&guestCount=2`)
      .set('Cookie', owner.cookie)
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('INVALID_CITY_GROUP'));
    await http()
      .get(`/api/itineraries/${itineraryId}/hotels?guestCount=2`)
      .set('Cookie', owner.cookie)
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('VALIDATION_FAILED'));
    await http()
      .get(`/api/itineraries/${itineraryId}/hotels?group=1&guestCount=0`)
      .set('Cookie', owner.cookie)
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('VALIDATION_FAILED'));
  });

  it("answers 404 for another account's itinerary", async () => {
    await http()
      .get(`/api/itineraries/${itineraryId}/hotels?group=1&guestCount=2`)
      .set('Cookie', other.cookie)
      .expect(404)
      .expect((res) => expect(res.body.code).toBe('ITINERARY_NOT_FOUND'));
  });

  it('answers 409 for an itinerary without days', async () => {
    await http()
      .get(`/api/itineraries/${emptyItineraryId}/hotels?group=1&guestCount=2`)
      .set('Cookie', owner.cookie)
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('ITINERARY_HAS_NO_DAYS'));
  });

  it('refuses a stay in the past, as hotel search does', async () => {
    const past = await http()
      .post('/api/itineraries')
      .set('Cookie', owner.cookie)
      .send({ title: 'E2E past', countries: ['FR'], startDate: '2020-01-10' })
      .expect(201);
    await http()
      .post(`/api/itineraries/${past.body.id}/days`)
      .set('Cookie', owner.cookie)
      .send({ city: 'paris' })
      .expect(201);
    await http()
      .get(`/api/itineraries/${past.body.id}/hotels?group=1&guestCount=1`)
      .set('Cookie', owner.cookie)
      .expect(400)
      .expect((res) =>
        expect(res.body.message).toBe('checkInDate cannot be in the past'),
      );
  });
});
