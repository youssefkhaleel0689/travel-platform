// GET /api/flights/search against the real app and the shared database (FLT-11, FLT-12,
// FLT-15). This test WRITES: it creates two airlines named "KE e2e search ..." (one ACTIVE,
// one DEACTIVATED) with an unused two-digit IATA code, and flights numbered KE5xxx in
// January 2099. afterAll deletes exactly those by _id. Run `npm run seed` first: it uses
// the seeded airports CAI and DXB.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import type {
  FlightSearchPageDto,
  FlightSearchResponseDto,
} from './../src/flights/flight-search/dto/flight-search-response.dto';
import {
  Airline,
  AirlineStatus,
} from './../src/flights/schemas/airline.schema';
import {
  CabinCategory,
  Flight,
  FlightStatus,
} from './../src/flights/schemas/flight.schema';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
const CONNECT_TIMEOUT_MS = 30_000;

const SEARCH = '/api/flights/search';
const OUTBOUND_DATE = '2099-01-15';
const RETURN_DATE = '2099-01-20';

// A cabin of a test flight with `free` of `total` seats free.
function cabin(
  category: CabinCategory,
  price: string,
  total: number,
  free: number,
) {
  return {
    category,
    totalSeats: total,
    bookedSeats: total - free,
    heldSeats: 0,
    price: Types.Decimal128.fromString(price),
    freeBaggageCount: 1,
    maxBagWeightKg: 23,
  };
}

describe('Flight search (e2e, shared database)', () => {
  let app: INestApplication<App>;
  let airlineModel: Model<Airline>;
  let flightModel: Model<Flight>;
  const airlineIds: Types.ObjectId[] = [];
  const flightIds: Types.ObjectId[] = [];
  let activeId: string;
  let deactivatedId: string;
  let activeIataCode: string;

  // Two-digit codes are valid (FLT-01) but no real airline uses them.
  async function unusedIataCode(): Promise<string> {
    for (let n = 0; n < 100; n++) {
      const code = String(n).padStart(2, '0');
      if (!(await airlineModel.exists({ iataCode: code }).exec())) {
        return code;
      }
    }
    throw new Error('No unused two-digit IATA code for the test airlines');
  }

  async function createAirline(status: AirlineStatus): Promise<Airline> {
    const airline = await airlineModel.create({
      name: `KE e2e search ${status}`,
      iataCode: await unusedIataCode(),
      status,
      createdBy: new Types.ObjectId(),
    });
    airlineIds.push(airline._id);
    return airline;
  }

  // CAI is on UTC+2 and DXB on UTC+4 in January.
  async function createFlight(fields: Partial<Flight>): Promise<void> {
    const flight = await flightModel.create({
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2099-01-15T08:00',
      arrivalLocalInput: '2099-01-15T13:00',
      departureAtUtc: new Date('2099-01-15T06:00:00Z'),
      arrivalAtUtc: new Date('2099-01-15T09:00:00Z'),
      departureDateKey: OUTBOUND_DATE,
      status: FlightStatus.SCHEDULED,
      ...fields,
    });
    flightIds.push(flight._id);
  }

  function search(params: Record<string, string>) {
    return request(app.getHttpServer())
      .get(SEARCH)
      .query({
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureDate: OUTBOUND_DATE,
        ...params,
      });
  }

  // Other teams may have flights on the same route and date: look at ours only.
  function ours(page: FlightSearchPageDto | null): string[] {
    return (page?.items ?? [])
      .filter((item) => item.airline.id === activeId)
      .map((item) => item.flightNumber);
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

    const active = await createAirline(AirlineStatus.ACTIVE);
    const deactivated = await createAirline(AirlineStatus.DEACTIVATED);
    activeId = active._id.toString();
    deactivatedId = deactivated._id.toString();
    activeIataCode = active.iataCode;

    // 3h, economy 250.00 with 100 free, business 900.00 with 1 free.
    await createFlight({
      airlineId: active._id,
      flightNumber: 'KE5101',
      cabinInventory: [
        cabin(CabinCategory.ECONOMY, '250.00', 100, 100),
        cabin(CabinCategory.BUSINESS, '900.00', 10, 1),
      ],
    });
    // 2h30, leaves later, economy 180.50 with 1 free (1 booked, 1 held).
    await createFlight({
      airlineId: active._id,
      flightNumber: 'KE5102',
      departureLocalInput: '2099-01-15T10:00',
      arrivalLocalInput: '2099-01-15T14:30',
      departureAtUtc: new Date('2099-01-15T08:00:00Z'),
      arrivalAtUtc: new Date('2099-01-15T10:30:00Z'),
      cabinInventory: [
        {
          ...cabin(CabinCategory.ECONOMY, '180.50', 3, 1),
          bookedSeats: 1,
          heldSeats: 1,
        },
      ],
    });
    // Cheapest, but CANCELLED.
    await createFlight({
      airlineId: active._id,
      flightNumber: 'KE5103',
      status: FlightStatus.CANCELLED,
      cabinInventory: [cabin(CabinCategory.ECONOMY, '50.00', 100, 100)],
    });
    // Bookable, but its airline is DEACTIVATED (ACC-15).
    await createFlight({
      airlineId: deactivated._id,
      flightNumber: 'KE5201',
      cabinInventory: [cabin(CabinCategory.ECONOMY, '60.00', 100, 100)],
    });
    // The way back, DXB -> CAI.
    await createFlight({
      airlineId: active._id,
      flightNumber: 'KE5104',
      departureAirportId: 'DXB',
      arrivalAirportId: 'CAI',
      departureLocalInput: '2099-01-20T14:00',
      arrivalLocalInput: '2099-01-20T15:30',
      departureAtUtc: new Date('2099-01-20T10:00:00Z'),
      arrivalAtUtc: new Date('2099-01-20T13:30:00Z'),
      departureDateKey: RETURN_DATE,
      cabinInventory: [cabin(CabinCategory.ECONOMY, '230.00', 100, 100)],
    });
  }, CONNECT_TIMEOUT_MS);

  // Deletes only what this file created, then closes the app and the connection.
  afterAll(async () => {
    await flightModel.deleteMany({ _id: { $in: flightIds } }).exec();
    await airlineModel.deleteMany({ _id: { $in: airlineIds } }).exec();
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it('is public and lists only bookable flights of ACTIVE airlines, cheapest first', async () => {
    const res = await search({}).expect(200);
    const body = res.body as FlightSearchResponseDto;

    expect(ours(body.outbound)).toEqual(['KE5102', 'KE5101']);
    expect(
      body.outbound.items.some((item) => item.airline.id === deactivatedId),
    ).toBe(false);
    expect(body.inbound).toBeNull();
    expect(
      body.outbound.items.find((item) => item.flightNumber === 'KE5101'),
    ).toEqual({
      id: expect.any(String),
      airline: {
        id: activeId,
        name: 'KE e2e search ACTIVE',
        iataCode: activeIataCode,
      },
      flightNumber: 'KE5101',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalTime: '2099-01-15T08:00:00+02:00',
      arrivalLocalTime: '2099-01-15T13:00:00+04:00',
      departureAtUtc: '2099-01-15T06:00:00.000Z',
      arrivalAtUtc: '2099-01-15T09:00:00.000Z',
      durationMinutes: 180,
      lowestPrice: '250.00',
      cabins: [
        {
          category: 'ECONOMY',
          pricePerSeat: '250.00',
          seatsAvailable: 100,
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
        {
          category: 'BUSINESS',
          pricePerSeat: '900.00',
          seatsAvailable: 1,
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
      ],
    });
  });

  it('needs a seat for every adult and child, but none for an infant', async () => {
    const res = await search({
      adults: '1',
      children: '1',
      infants: '1',
    }).expect(200);
    const body = res.body as FlightSearchResponseDto;

    // KE5102 and the business cabin of KE5101 have 1 free seat; 2 are needed.
    expect(ours(body.outbound)).toEqual(['KE5101']);
    const [flight] = body.outbound.items.filter(
      (item) => item.airline.id === activeId,
    );
    expect(flight.cabins.map((c) => c.category)).toEqual(['ECONOMY']);
  });

  it('filters by cabin and by an inclusive price range', async () => {
    const business = (await search({ cabin: 'business' }).expect(200))
      .body as FlightSearchResponseDto;
    expect(ours(business.outbound)).toEqual(['KE5101']);
    expect(business.outbound.items[0]).toMatchObject({
      lowestPrice: '900.00',
      cabins: [{ category: 'BUSINESS' }],
    });

    // Both ends are included: 180.50 and 250.00 stay, 900.00 goes.
    const range = (
      await search({ minPrice: '180.50', maxPrice: '250' }).expect(200)
    ).body as FlightSearchResponseDto;
    expect(ours(range.outbound)).toEqual(['KE5102', 'KE5101']);
    const kept = range.outbound.items.find(
      (item) => item.flightNumber === 'KE5101',
    );
    expect(kept?.cabins.map((c) => c.category)).toEqual(['ECONOMY']);
  });

  it.each([
    [{ sortBy: 'price', sortOrder: 'desc' }, ['KE5101', 'KE5102']],
    [{ sortBy: 'duration' }, ['KE5102', 'KE5101']],
    [{ sortBy: 'departureTime' }, ['KE5101', 'KE5102']],
  ])('sorts by %o', async (params, expected) => {
    const res = await search(params).expect(200);

    expect(ours((res.body as FlightSearchResponseDto).outbound)).toEqual(
      expected,
    );
  });

  it('returns the flights back on returnDate for a round trip', async () => {
    const res = await search({
      tripType: 'ROUND_TRIP',
      returnDate: RETURN_DATE,
    }).expect(200);
    const body = res.body as FlightSearchResponseDto;

    expect(ours(body.outbound)).toEqual(['KE5102', 'KE5101']);
    expect(ours(body.inbound)).toEqual(['KE5104']);
    expect(body.inbound?.items[0]).toMatchObject({
      departureAirportId: 'DXB',
      arrivalAirportId: 'CAI',
      departureLocalTime: '2099-01-20T14:00:00+04:00',
      arrivalLocalTime: '2099-01-20T15:30:00+02:00',
    });
    expect(body.inbound?.meta).toMatchObject({ page: 1, pageSize: 10 });
  });

  describe('errors', () => {
    it('rejects the same airport twice (VALIDATION_FAILED)', async () => {
      const res = await search({ arrivalAirportId: 'CAI' }).expect(400);

      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        path: SEARCH,
        errors: [
          {
            field: 'arrivalAirportId',
            messages: ['arrivalAirportId must differ from departureAirportId'],
          },
        ],
      });
    });

    it('requires returnDate for a round trip (VALIDATION_FAILED)', async () => {
      const res = await search({ tripType: 'ROUND_TRIP' }).expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors).toEqual([
        { field: 'returnDate', messages: expect.any(Array) },
      ]);
    });

    it('rejects an airport that is not seeded (UNKNOWN_AIRPORT)', async () => {
      const res = await search({ arrivalAirportId: 'ZZZ' }).expect(400);

      expect(res.body).toMatchObject({
        code: 'UNKNOWN_AIRPORT',
        message: 'Unknown airport: ZZZ',
      });
    });

    it('rejects a date before today at the airport (DEPARTURE_DATE_IN_PAST)', async () => {
      const res = await search({ departureDate: '2020-01-01' }).expect(400);

      expect(res.body).toMatchObject({
        code: 'DEPARTURE_DATE_IN_PAST',
        errors: [
          {
            field: 'departureDate',
            messages: ['departureDate must not be before today at CAI'],
          },
        ],
      });
    });
  });
});
