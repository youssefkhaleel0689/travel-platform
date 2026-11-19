// GET /api/itineraries/:id/flights (ITN-26) against the real app and the shared database.
// This test WRITES: one airline named "KE e2e itinerary flights" with an unused two-digit
// IATA code from 70 up, flights numbered KE8xxx in March 2099, test_c2_ accounts made by
// the shared helper and their itineraries. afterAll deletes exactly those. It uses the
// seeded airports CAI and DXB and the seeded cities cairo and dubai.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import {
  Airline,
  AirlineStatus,
} from './../src/flights/schemas/airline.schema';
import {
  CabinCategory,
  Flight,
  FlightStatus,
} from './../src/flights/schemas/flight.schema';
import { Itinerary } from './../src/itineraries/schemas/itinerary.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

// Atlas, account registration over HTTP and index builds all happen in beforeAll.
const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

describe('Itinerary flight search (e2e, shared database)', () => {
  let app: INestApplication<App>;
  let airlineModel: Model<Airline>;
  let flightModel: Model<Flight>;
  let itineraryModel: Model<Itinerary>;
  const userIds: string[] = [];
  const flightIds: Types.ObjectId[] = [];
  let airlineId: Types.ObjectId;
  let traveller: SignedInUser;
  let otherTraveller: SignedInUser;
  // Starts on 20 March 2099 in Dubai and stays two days: the last day is the 21st.
  let itineraryId: string;
  let emptyItineraryId: string;
  let outboundId: string;
  let returnId: string;

  async function unusedIataCode(): Promise<string> {
    for (let n = 70; n < 100; n++) {
      const code = String(n);
      if (!(await airlineModel.exists({ iataCode: code }).exec())) {
        return code;
      }
    }
    throw new Error('No unused two-digit IATA code for the test airline');
  }

  // A SCHEDULED flight with one ECONOMY cabin. CAI is UTC+2 and DXB UTC+4 in March.
  async function createFlight(fields: Partial<Flight>): Promise<string> {
    const flight = await flightModel.create({
      airlineId,
      flightNumber: `KE8${String(flightIds.length + 1).padStart(3, '0')}`,
      status: FlightStatus.SCHEDULED,
      cabinInventory: [
        {
          category: CabinCategory.ECONOMY,
          totalSeats: 10,
          bookedSeats: 0,
          heldSeats: 0,
          price: Types.Decimal128.fromString('250.00'),
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
      ],
      ...fields,
    });
    flightIds.push(flight._id);
    return flight._id.toString();
  }

  function http() {
    return request(app.getHttpServer());
  }

  function search(id: string, query: Record<string, string>, user = traveller) {
    return http()
      .get(`/api/itineraries/${id}/flights`)
      .query(query)
      .set('Cookie', user.cookie);
  }

  function ids(page: { items: { id: string }[] }): string[] {
    return page.items.map((item) => item.id);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    airlineModel = app.get<Model<Airline>>(getModelToken(Airline.name));
    flightModel = app.get<Model<Flight>>(getModelToken(Flight.name));
    itineraryModel = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));

    const airline = await airlineModel.create({
      name: 'KE e2e itinerary flights',
      iataCode: await unusedIataCode(),
      status: AirlineStatus.ACTIVE,
      createdBy: new Types.ObjectId(),
    });
    airlineId = airline._id;

    // CAI 08:30 -> DXB 14:30 on the start date.
    outboundId = await createFlight({
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2099-03-20T08:30',
      arrivalLocalInput: '2099-03-20T14:30',
      departureAtUtc: new Date('2099-03-20T06:30:00Z'),
      arrivalAtUtc: new Date('2099-03-20T10:30:00Z'),
      departureDateKey: '2099-03-20',
    });
    // DXB 16:00 -> CAI 18:00 on the last day.
    returnId = await createFlight({
      departureAirportId: 'DXB',
      arrivalAirportId: 'CAI',
      departureLocalInput: '2099-03-21T16:00',
      arrivalLocalInput: '2099-03-21T18:00',
      departureAtUtc: new Date('2099-03-21T12:00:00Z'),
      arrivalAtUtc: new Date('2099-03-21T16:00:00Z'),
      departureDateKey: '2099-03-21',
    });

    traveller = await createSignedInUser(app, { label: 'ke-itn-flights' });
    otherTraveller = await createSignedInUser(app, {
      label: 'ke-itn-flights-other',
    });
    userIds.push(traveller.userId, otherTraveller.userId);

    // The itineraries are made through D1's own endpoints (ITN-01, ITN-05).
    const created = await http()
      .post('/api/itineraries')
      .set('Cookie', traveller.cookie)
      .send({
        title: 'KE e2e Dubai',
        countries: ['AE'],
        startDate: '2099-03-20',
      })
      .expect(201);
    itineraryId = (created.body as { id: string }).id;
    for (const city of ['dubai', 'dubai']) {
      await http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', traveller.cookie)
        .send({ city })
        .expect(201);
    }
    const empty = await http()
      .post('/api/itineraries')
      .set('Cookie', traveller.cookie)
      .send({
        title: 'KE e2e no days',
        countries: ['AE'],
        startDate: '2099-03-20',
      })
      .expect(201);
    emptyItineraryId = (empty.body as { id: string }).id;
  }, CONNECT_TIMEOUT_MS);

  // Deletes only what this file created, then closes the app and the connection.
  afterAll(async () => {
    await itineraryModel
      .deleteMany({
        userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
      })
      .exec();
    await flightModel.deleteMany({ _id: { $in: flightIds } }).exec();
    await airlineModel.deleteMany({ _id: airlineId }).exec();
    await deleteTestUsers(app, userIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it('needs a login', async () => {
    await http()
      .get(`/api/itineraries/${itineraryId}/flights`)
      .query({ originAirportId: 'CAI' })
      .expect(401);
  });

  it(
    "flies one way to the first day's city on the itinerary's start date",
    async () => {
      const res = await search(itineraryId, { originAirportId: 'CAI' }).expect(
        200,
      );

      expect(res.body).toMatchObject({
        destinationCityId: 'dubai',
        destinationAirportIds: ['DXB'],
        departureDate: '2099-03-20',
        returnDate: null,
        inbound: null,
      });
      expect(ids(res.body.outbound)).toContain(outboundId);
    },
    SLOW_MS,
  );

  it(
    "comes back on the itinerary's last day for a round trip",
    async () => {
      const res = await search(itineraryId, {
        originAirportId: 'CAI',
        tripType: 'ROUND_TRIP',
      }).expect(200);

      expect(res.body).toMatchObject({
        departureDate: '2099-03-20',
        returnDate: '2099-03-21',
      });
      expect(ids(res.body.outbound)).toContain(outboundId);
      expect(ids(res.body.inbound)).toContain(returnId);
    },
    SLOW_MS,
  );

  it('uses the dates the user chooses instead of the defaults', async () => {
    const res = await search(itineraryId, {
      originAirportId: 'CAI',
      departureDate: '2099-03-19',
    }).expect(200);

    expect(res.body.departureDate).toBe('2099-03-19');
    expect(ids(res.body.outbound)).not.toContain(outboundId);
  });

  it("answers 404 for another account's itinerary", async () => {
    const res = await search(
      itineraryId,
      { originAirportId: 'CAI' },
      otherTraveller,
    ).expect(404);

    expect(res.body.code).toBe('ITINERARY_NOT_FOUND');
  });

  it('refuses an origin inside the destination city', async () => {
    const res = await search(itineraryId, { originAirportId: 'DXB' }).expect(
      400,
    );

    expect(res.body).toMatchObject({
      code: 'ORIGIN_IN_DESTINATION_CITY',
      errors: [{ field: 'originAirportId' }],
    });
  });

  it('answers 409 for an itinerary without days', async () => {
    const res = await search(emptyItineraryId, {
      originAirportId: 'CAI',
    }).expect(409);

    expect(res.body.code).toBe('ITINERARY_HAS_NO_DAYS');
  });
});
