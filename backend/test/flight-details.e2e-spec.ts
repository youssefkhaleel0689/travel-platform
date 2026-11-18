// GET /api/flights/:id (FLT-17) against the real app and the shared database. This test
// WRITES: two airlines named "KE e2e details ..." (one ACTIVE, one DEACTIVATED) with unused
// two-digit IATA codes from 30 up, the active one's policy, and flights numbered KE7xxx in
// March 2099. afterAll deletes exactly those by _id. It uses the seeded airports CAI and DXB.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { AirlinePolicy } from './../src/flights/schemas/airline-policy.schema';
import {
  Airline,
  AirlineStatus,
} from './../src/flights/schemas/airline.schema';
import {
  CabinCategory,
  Flight,
  FlightStatus,
} from './../src/flights/schemas/flight.schema';

// Atlas and index builds happen in beforeAll.
const CONNECT_TIMEOUT_MS = 120_000;

describe('Flight details (e2e, shared database)', () => {
  let app: INestApplication<App>;
  let airlineModel: Model<Airline>;
  let policyModel: Model<AirlinePolicy>;
  let flightModel: Model<Flight>;
  const airlineIds: Types.ObjectId[] = [];
  const flightIds: Types.ObjectId[] = [];
  let activeAirline: Airline;
  let flightId: string;
  let hiddenFlightId: string;

  async function unusedIataCode(): Promise<string> {
    for (let n = 30; n < 50; n++) {
      const code = String(n);
      if (!(await airlineModel.exists({ iataCode: code }).exec())) {
        return code;
      }
    }
    throw new Error('No unused two-digit IATA code for the test airline');
  }

  async function createAirline(
    name: string,
    status: AirlineStatus,
  ): Promise<Airline> {
    const airline = await airlineModel.create({
      name,
      iataCode: await unusedIataCode(),
      status,
      createdBy: new Types.ObjectId(),
    });
    airlineIds.push(airline._id);
    return airline.toObject<Airline>();
  }

  // CAI -> DXB on 10 March 2099: 08:30 in Cairo (UTC+2), 14:30 in Dubai (UTC+4).
  async function createFlight(airlineId: Types.ObjectId): Promise<string> {
    const flight = await flightModel.create({
      airlineId,
      flightNumber: `KE7${String(flightIds.length + 1).padStart(3, '0')}`,
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2099-03-10T08:30',
      arrivalLocalInput: '2099-03-10T14:30',
      departureAtUtc: new Date('2099-03-10T06:30:00Z'),
      arrivalAtUtc: new Date('2099-03-10T10:30:00Z'),
      departureDateKey: '2099-03-10',
      status: FlightStatus.SCHEDULED,
      cabinInventory: [
        {
          category: CabinCategory.ECONOMY,
          totalSeats: 10,
          bookedSeats: 3,
          heldSeats: 1,
          price: Types.Decimal128.fromString('200.00'),
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
        {
          category: CabinCategory.BUSINESS,
          totalSeats: 4,
          bookedSeats: 4,
          heldSeats: 0,
          price: Types.Decimal128.fromString('900.00'),
          freeBaggageCount: 2,
          maxBagWeightKg: 32,
        },
      ],
    });
    flightIds.push(flight._id);
    return flight._id.toString();
  }

  function details(id: string) {
    // No cookie: the details page is public, like search.
    return request(app.getHttpServer()).get(`/api/flights/${id}`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    airlineModel = app.get<Model<Airline>>(getModelToken(Airline.name));
    policyModel = app.get<Model<AirlinePolicy>>(
      getModelToken(AirlinePolicy.name),
    );
    flightModel = app.get<Model<Flight>>(getModelToken(Flight.name));

    activeAirline = await createAirline(
      'KE e2e details active',
      AirlineStatus.ACTIVE,
    );
    const hiddenAirline = await createAirline(
      'KE e2e details deactivated',
      AirlineStatus.DEACTIVATED,
    );
    await policyModel.create({
      airlineId: activeAirline._id,
      extraBagPrice: Types.Decimal128.fromString('15.00'),
      maxExtraBagsPerPassenger: 2,
      cancellationTiers: [
        { daysBeforeDeparture: 0, refundPercentage: 0 },
        { daysBeforeDeparture: 7, refundPercentage: 80 },
      ],
      version: 1,
      updatedBy: new Types.ObjectId(),
    });
    flightId = await createFlight(activeAirline._id);
    hiddenFlightId = await createFlight(hiddenAirline._id);
  }, CONNECT_TIMEOUT_MS);

  // Deletes only what this file created, then closes the app and the connection.
  afterAll(async () => {
    await flightModel.deleteMany({ _id: { $in: flightIds } }).exec();
    await policyModel.deleteMany({ airlineId: { $in: airlineIds } }).exec();
    await airlineModel.deleteMany({ _id: { $in: airlineIds } }).exec();
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it('shows a guest everything the details page needs', async () => {
    const res = await details(flightId).expect(200);

    expect(res.body).toEqual({
      id: flightId,
      status: FlightStatus.SCHEDULED,
      airline: {
        id: activeAirline._id.toString(),
        name: 'KE e2e details active',
        iataCode: activeAirline.iataCode,
      },
      flightNumber: 'KE7001',
      departureAirport: expect.objectContaining({
        id: 'CAI',
        timeZone: 'Africa/Cairo',
      }) as object,
      arrivalAirport: expect.objectContaining({
        id: 'DXB',
        timeZone: 'Asia/Dubai',
      }) as object,
      departureLocalTime: '2099-03-10T08:30:00+02:00',
      arrivalLocalTime: '2099-03-10T14:30:00+04:00',
      departureAtUtc: '2099-03-10T06:30:00.000Z',
      arrivalAtUtc: '2099-03-10T10:30:00.000Z',
      durationMinutes: 240,
      cabins: [
        {
          category: CabinCategory.ECONOMY,
          pricePerSeat: '200.00',
          seatsRemaining: 6,
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
        {
          category: CabinCategory.BUSINESS,
          pricePerSeat: '900.00',
          seatsRemaining: 0,
          freeBaggageCount: 2,
          maxBagWeightKg: 32,
        },
      ],
      policy: {
        extraBagPrice: '15.00',
        maxExtraBagsPerPassenger: 2,
        cancellationTiers: [
          { daysBeforeDeparture: 7, refundPercentage: 80 },
          { daysBeforeDeparture: 0, refundPercentage: 0 },
        ],
      },
    });
  });

  it('answers the same 404 for a missing flight, a bad id and a deactivated airline', async () => {
    const responses = [
      await details(new Types.ObjectId().toString()).expect(404),
      await details('not-an-id').expect(404),
      await details(hiddenFlightId).expect(404),
    ];

    for (const res of responses) {
      expect(res.body).toMatchObject({
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight not found',
      });
    }
  });

  it('leaves GET /api/flights/search to search, not to the details route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/flights/search')
      .query({
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureDate: '2099-03-10',
      })
      .expect(200);

    expect(res.body.outbound.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: flightId }) as object,
      ]),
    );
  });
});
