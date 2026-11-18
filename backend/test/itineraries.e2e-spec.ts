// Itineraries end to end against the shared database (ITN-01, 03, 05, 07, 08,
// 10, 14, 16, 18, 20, 21; ACC-11 ownership). Every itinerary it creates belongs
// to a test account made here, and afterAll deletes exactly those itineraries
// (by owner) and those accounts. Exchange rates are stubbed, so no call goes
// to FXRatesAPI.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { ExchangeRatesService } from './../src/exchange-rates/exchange-rates.service';
import { Itinerary } from './../src/itineraries/schemas/itinerary.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;
const MISSING_ID = new Types.ObjectId().toString();

describe('Itineraries (e2e)', () => {
  let app: INestApplication<App>;
  let itineraryModel: Model<Itinerary>;
  const createdUserIds: string[] = [];
  let owner: SignedInUser;
  let other: SignedInUser;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    itineraryModel = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));

    jest.spyOn(app.get(ExchangeRatesService), 'getRates').mockResolvedValue({
      base: 'USD',
      rates: {
        USD: 1,
        EUR: 0.9,
        GBP: 0.8,
        EGP: 50,
        AED: 3.67,
        JPY: 150,
        SAR: 3.75,
      },
      rateDate: '2026-11-18',
      stale: false,
    });

    owner = await createSignedInUser(app, { label: 'itn_owner' });
    other = await createSignedInUser(app, { label: 'itn_other' });
    createdUserIds.push(owner.userId, other.userId);
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

  it('rejects a guest (401)', async () => {
    await http().get('/api/itineraries').expect(401);
  });

  it(
    'creates, fills, protects, publishes and clones an itinerary',
    async () => {
      // ITN-01: create (countries are checked against the seeded list)
      await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({ title: 'Bad', countries: ['XX'], startDate: '2026-12-20' })
        .expect(400)
        .expect((res) => expect(res.body.code).toBe('UNKNOWN_COUNTRY'));

      const created = await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({
          title: 'E2E Paris and London',
          countries: ['fr', 'GB'],
          startDate: '2026-12-20',
        })
        .expect(201);
      const id = created.body.id as string;
      expect(created.body.ownerId).toBe(owner.userId);
      expect(created.body.countries).toEqual(['FR', 'GB']);
      expect(created.body.visibility).toBe('private');

      // The owner is stored as an ObjectId, so the ownership filter matches it.
      const stored = await itineraryModel.findById(id).lean().exec();
      expect(stored?.userId).toBeInstanceOf(Types.ObjectId);

      // ITN-05: days (cities are checked against the seeded list)
      await http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', owner.cookie)
        .send({ city: 'atlantis' })
        .expect(400)
        .expect((res) => expect(res.body.code).toBe('UNKNOWN_CITY'));
      await http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', owner.cookie)
        .send({ city: 'paris' })
        .expect(201);
      const withDays = await http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', owner.cookie)
        .send({ city: 'london' })
        .expect(201);
      const [day1, day2] = withDays.body.days as { id: string; date: string }[];
      expect(withDays.body.days.map((d: { date: string }) => d.date)).toEqual([
        '2026-12-20',
        '2026-12-21',
      ]);

      // ITN-08: reorder, dates follow the new order
      const reordered = await http()
        .patch(`/api/itineraries/${id}/days/reorder`)
        .set('Cookie', owner.cookie)
        .send({ dayId: day2.id, position: 1 })
        .expect(200);
      expect(reordered.body.days[0]).toMatchObject({
        id: day2.id,
        city: 'london',
        date: '2026-12-20',
      });

      // ITN-10, ITN-14, ITN-16: money is stored as Decimal128, returned as a string
      const activity = await http()
        .post(`/api/itineraries/${id}/days/${day1.id}/activities`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Louvre', cost: 22.5, currency: 'eur' })
        .expect(201);
      expect(activity.body).toMatchObject({ cost: '22.50', currency: 'EUR' });

      await http()
        .post(`/api/itineraries/${id}/days/${day1.id}/budgets`)
        .set('Cookie', owner.cookie)
        .send({ category: 'food', amount: 40, currency: 'XYZ' })
        .expect(400)
        .expect((res) => expect(res.body.code).toBe('UNSUPPORTED_CURRENCY'));
      const budget = await http()
        .post(`/api/itineraries/${id}/days/${day1.id}/budgets`)
        .set('Cookie', owner.cookie)
        .send({ category: 'food', amount: 67.5, currency: 'EUR' })
        .expect(201);
      expect(budget.body.amount).toBe('67.50');

      await http()
        .post(`/api/itineraries/${id}/transport-costs`)
        .set('Cookie', owner.cookie)
        .send({
          mode: 'train',
          fromCity: 'london',
          toCity: 'paris',
          amount: 80,
          currency: 'GBP',
          dayId: day1.id,
        })
        .expect(201)
        .expect((res) => expect(res.body.amount).toBe('80.00'));

      // ITN-14, ITN-18: summary in USD with the stubbed rates
      // food 67.50 EUR = 75.00, activity 22.50 EUR = 25.00, train 80 GBP = 100.00
      const summary = await http()
        .get(`/api/itineraries/${id}/budget-summary?currency=usd`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(summary.body).toMatchObject({
        currency: 'USD',
        total: '200.00',
        byCategory: {
          food: '75.00',
          activities: '25.00',
          intercity_transport: '100.00',
        },
      });

      // ACC-11: another user gets the same 404 as for a missing id
      for (const path of [
        `/api/itineraries/${id}`,
        `/api/itineraries/${MISSING_ID}`,
        '/api/itineraries/not-an-id',
      ]) {
        await http()
          .get(path)
          .set('Cookie', other.cookie)
          .expect(404)
          .expect((res) => expect(res.body.code).toBe('ITINERARY_NOT_FOUND'));
      }
      await http()
        .patch(`/api/budgets/${budget.body.id as string}`)
        .set('Cookie', other.cookie)
        .send({ amount: 1 })
        .expect(404)
        .expect((res) => expect(res.body.code).toBe('BUDGET_ENTRY_NOT_FOUND'));

      // Private: not visible to guests
      await http().get(`/api/itineraries/public/${id}`).expect(404);

      // ITN-20: publish through PATCH /:id (section 8.8 maps it to ITN-20 too)
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'public' })
        .expect(200)
        .expect((res) => expect(res.body.visibility).toBe('public'));

      // ITN-21: guests search and view; the keyword matches a city name
      const search = await http()
        .get('/api/itineraries/public/search?q=London&country=FR')
        .expect(200);
      expect(
        (search.body.items as { id: string }[]).some((i) => i.id === id),
      ).toBe(true);
      await http().get(`/api/itineraries/public/${id}`).expect(200);

      // ITN-21: clone is a private copy owned by the cloner, with attribution
      const clone = await http()
        .post(`/api/itineraries/${id}/clone`)
        .set('Cookie', other.cookie)
        .expect(201);
      expect(clone.body).toMatchObject({
        ownerId: other.userId,
        visibility: 'private',
        clonedFrom: { itineraryId: id, authorId: owner.userId },
      });
      expect(clone.body.days[0].id).not.toBe(reordered.body.days[0].id);

      // ITN-07: deleting a day removes its transport cost
      const afterDelete = await http()
        .delete(`/api/itineraries/${id}/days/${day1.id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(afterDelete.body.days).toHaveLength(1);
      expect(afterDelete.body.transportCosts).toEqual([]);

      // ITN-01: delete
      await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', owner.cookie)
        .expect(404);
    },
    SLOW_MS * 2,
  );
});
