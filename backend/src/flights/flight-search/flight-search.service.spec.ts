import { BadRequestException, HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import type { AirportDto } from '../../common/reference-data/dto/airport.dto';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import type { FlightSearchItemDto } from './dto/flight-search-response.dto';
import { FlightSortBy, SortOrder, TripType } from './flight-search.constants';
import type { FlightMatch } from './flight-search.mapper';
import { FlightSearchService, type LegCriteria } from './flight-search.service';

// 23:30 UTC: already the 21st in Tokyo, still the 20th in New York.
const NOW = new Date('2026-11-20T23:30:00.000Z');
const AIRLINE_ID = new Types.ObjectId();
const FLIGHT_ID = new Types.ObjectId();

const AIRPORTS: Record<string, AirportDto> = {
  JFK: {
    id: 'JFK',
    name: 'John F. Kennedy International Airport',
    cityId: 'NYC',
    countryId: 'US',
    timeZone: 'America/New_York',
  },
  NRT: {
    id: 'NRT',
    name: 'Narita International Airport',
    cityId: 'TYO',
    countryId: 'JP',
    timeZone: 'Asia/Tokyo',
  },
  CAI: {
    id: 'CAI',
    name: 'Cairo International Airport',
    cityId: 'CAI',
    countryId: 'EG',
    timeZone: 'Africa/Cairo',
  },
};

function criteria(overrides: Partial<LegCriteria> = {}): LegCriteria {
  return {
    departureAirportId: 'JFK',
    arrivalAirportIds: ['CAI'],
    departureDate: '2026-11-20',
    dateField: 'departureDate',
    seats: 2,
    sortBy: FlightSortBy.PRICE,
    sortOrder: SortOrder.ASC,
    ...overrides,
  };
}

// What the aggregation returns for one flight: airlineId, no airline yet.
function match(overrides: Partial<FlightMatch> = {}): FlightMatch {
  const price = Types.Decimal128.fromString('450.00');
  return {
    _id: FLIGHT_ID,
    airlineId: AIRLINE_ID,
    flightNumber: 'MS986',
    departureAirportId: 'JFK',
    arrivalAirportId: 'CAI',
    departureAtUtc: new Date('2026-11-21T03:00:00.000Z'),
    arrivalAtUtc: new Date('2026-11-21T14:30:00.000Z'),
    cabins: [
      {
        category: CabinCategory.ECONOMY,
        price,
        freeSeats: 40,
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
    ],
    lowestPrice: price,
    ...overrides,
  };
}

// A result of searchLeg, for the tests that replace it.
function searchItem(flightNumber: string): FlightSearchItemDto {
  return {
    id: FLIGHT_ID.toString(),
    airline: { id: AIRLINE_ID.toString(), name: 'EgyptAir', iataCode: 'MS' },
    flightNumber,
    departureAirportId: 'JFK',
    arrivalAirportId: 'NRT',
    departureLocalTime: '2026-11-20T22:00:00-05:00',
    arrivalLocalTime: '2026-11-22T03:30:00+09:00',
    departureAtUtc: '2026-11-21T03:00:00.000Z',
    arrivalAtUtc: '2026-11-21T18:30:00.000Z',
    durationMinutes: 930,
    lowestPrice: '450.00',
    cabins: [
      {
        category: CabinCategory.ECONOMY,
        pricePerSeat: '450.00',
        seatsAvailable: 40,
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
    ],
  };
}

// A validated query: the DTO's defaults apply (ONE_WAY, 1 adult, page 1, price asc).
function searchQuery(
  overrides: Partial<FlightSearchQueryDto> = {},
): FlightSearchQueryDto {
  return Object.assign(new FlightSearchQueryDto(), {
    departureAirportId: 'JFK',
    arrivalAirportId: 'NRT',
    departureDate: '2026-11-20',
    ...overrides,
  });
}

// A query stand-in: lean() and exec() resolve to the given result.
function query<R>(result: R) {
  const chain = {
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

// Fake models and reference data; the casts are done only here.
function setup(
  options: {
    airlines?: Pick<Airline, '_id' | 'name' | 'iataCode'>[];
    matches?: FlightMatch[];
  } = {},
) {
  const airlines = options.airlines ?? [
    { _id: AIRLINE_ID, name: 'EgyptAir', iataCode: 'MS' },
  ];
  const referenceData = {
    getAirportOrThrow: jest.fn((id: string) =>
      id in AIRPORTS
        ? Promise.resolve(AIRPORTS[id])
        : Promise.reject(
            new BadRequestException({
              code: 'UNKNOWN_AIRPORT',
              message: `Unknown airport: ${id}`,
            }),
          ),
    ),
  };
  const airlineModel = { find: jest.fn(() => query(airlines)) };
  const flightModel = {
    aggregate: jest.fn(() => query(options.matches ?? [match()])),
  };
  const service = new FlightSearchService(
    flightModel as unknown as Model<Flight>,
    airlineModel as unknown as Model<Airline>,
    referenceData as unknown as ReferenceDataService,
  );
  return { service, referenceData, airlineModel, flightModel };
}

// The pipeline the service passed to aggregate().
function pipelineOf(flightModel: ReturnType<typeof setup>['flightModel']) {
  const calls = flightModel.aggregate.mock.calls as unknown as [
    Record<string, unknown>[],
  ][];
  return calls[0][0];
}

interface CabinProjection {
  $project: Record<string, unknown> & {
    cabins: {
      $map: {
        input: { $filter: { input: string; cond: { $and: unknown[] } } };
        in: Record<string, unknown>;
      };
    };
  };
}

// The $project stage that picks the qualifying cabins.
function projectionOf(flightModel: ReturnType<typeof setup>['flightModel']) {
  return pipelineOf(flightModel)[1] as unknown as CabinProjection;
}

// Free seats as the pipeline computes them: total - booked - held.
const FREE_SEATS = {
  $subtract: [
    { $subtract: ['$$cabin.totalSeats', '$$cabin.bookedSeats'] },
    '$$cabin.heldSeats',
  ],
};

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

describe('FlightSearchService.searchLeg (FLT-11)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('checks the departure airport and every arrival airport', async () => {
    const { service, referenceData } = setup();
    await service.searchLeg(criteria({ arrivalAirportIds: ['CAI', 'NRT'] }));

    expect(referenceData.getAirportOrThrow.mock.calls).toEqual([
      ['JFK'],
      ['CAI'],
      ['NRT'],
    ]);
  });

  it('rejects an unknown airport before any flight query', async () => {
    const { service, flightModel, airlineModel } = setup();
    const error = await failure(
      service.searchLeg(criteria({ arrivalAirportIds: ['ZZZ'] })),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'UNKNOWN_AIRPORT' });
    expect(airlineModel.find).not.toHaveBeenCalled();
    expect(flightModel.aggregate).not.toHaveBeenCalled();
  });

  it('rejects a date before today at the departure airport', async () => {
    const { service, flightModel } = setup();
    // In Tokyo it is already 2026-11-21, so the 20th is in the past there.
    const error = await failure(
      service.searchLeg(
        criteria({ departureAirportId: 'NRT', departureDate: '2026-11-20' }),
      ),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: 'DEPARTURE_DATE_IN_PAST',
      message: 'departureDate must not be before today at NRT',
      errors: [
        {
          field: 'departureDate',
          messages: ['departureDate must not be before today at NRT'],
        },
      ],
    });
    expect(flightModel.aggregate).not.toHaveBeenCalled();
  });

  it('accepts today at the departure airport even when UTC is already tomorrow', async () => {
    const { service, flightModel } = setup();
    // In New York it is still 2026-11-20.
    await service.searchLeg(criteria({ departureDate: '2026-11-20' }));

    expect(flightModel.aggregate).toHaveBeenCalledTimes(1);
  });

  it('puts the error on the field that holds the date (return leg)', async () => {
    const { service } = setup();
    const error = await failure(
      service.searchLeg(
        criteria({
          departureAirportId: 'NRT',
          arrivalAirportIds: ['JFK'],
          departureDate: '2026-11-19',
          dateField: 'returnDate',
        }),
      ),
    );

    expect(error.getResponse()).toMatchObject({
      code: 'DEPARTURE_DATE_IN_PAST',
      errors: [{ field: 'returnDate' }],
    });
  });

  it('returns no flights without querying them when no airline is ACTIVE', async () => {
    const { service, airlineModel, flightModel } = setup({ airlines: [] });
    const result = await service.searchLeg(criteria());

    expect(airlineModel.find).toHaveBeenCalledWith(
      { status: AirlineStatus.ACTIVE },
      { name: 1, iataCode: 1 },
    );
    expect(result).toEqual([]);
    expect(flightModel.aggregate).not.toHaveBeenCalled();
  });

  it('matches on the search index, SCHEDULED, not departed and ACTIVE airlines only', async () => {
    const otherAirline = new Types.ObjectId();
    const { service, flightModel } = setup({
      airlines: [
        { _id: AIRLINE_ID, name: 'EgyptAir', iataCode: 'MS' },
        { _id: otherAirline, name: 'Nile Air', iataCode: 'NP' },
      ],
    });
    await service.searchLeg(criteria({ arrivalAirportIds: ['CAI', 'NRT'] }));

    expect(pipelineOf(flightModel)[0]).toEqual({
      $match: {
        departureAirportId: 'JFK',
        arrivalAirportId: { $in: ['CAI', 'NRT'] },
        departureDateKey: '2026-11-20',
        status: FlightStatus.SCHEDULED,
        departureAtUtc: { $gt: NOW },
        airlineId: { $in: [AIRLINE_ID, otherAirline] },
      },
    });
  });

  it('keeps any cabin with enough free seats when no cabin or price is given', async () => {
    const { service, flightModel } = setup();
    await service.searchLeg(criteria({ seats: 3 }));

    const filter = projectionOf(flightModel).$project.cabins.$map.input.$filter;
    expect(filter.input).toBe('$cabinInventory');
    expect(filter.cond.$and).toEqual([{ $gte: [FREE_SEATS, 3] }]);
    expect(pipelineOf(flightModel).slice(2)).toEqual([
      { $match: { 'cabins.0': { $exists: true } } },
      { $addFields: { lowestPrice: { $min: '$cabins.price' } } },
      { $sort: { lowestPrice: 1, departureAtUtc: 1, _id: 1 } },
    ]);
  });

  it('keeps only the asked cabin when one is given', async () => {
    const { service, flightModel } = setup();
    await service.searchLeg(criteria({ cabin: CabinCategory.BUSINESS }));

    const filter = projectionOf(flightModel).$project.cabins.$map.input.$filter;
    expect(filter.cond.$and).toEqual([
      { $gte: [FREE_SEATS, 2] },
      { $eq: ['$$cabin.category', CabinCategory.BUSINESS] },
    ]);
  });

  it('keeps only cabins priced within the inclusive range (FLT-15)', async () => {
    const { service, flightModel } = setup();
    await service.searchLeg(criteria({ minPrice: '100', maxPrice: '250.50' }));

    const filter = projectionOf(flightModel).$project.cabins.$map.input.$filter;
    expect(filter.cond.$and).toEqual([
      { $gte: [FREE_SEATS, 2] },
      { $gte: ['$$cabin.price', Types.Decimal128.fromString('100')] },
      { $lte: ['$$cabin.price', Types.Decimal128.fromString('250.50')] },
    ]);
  });

  it('applies a single bound when only one is given', async () => {
    const { service, flightModel } = setup();
    await service.searchLeg(criteria({ maxPrice: '99.99' }));

    const filter = projectionOf(flightModel).$project.cabins.$map.input.$filter;
    expect(filter.cond.$and).toEqual([
      { $gte: [FREE_SEATS, 2] },
      { $lte: ['$$cabin.price', Types.Decimal128.fromString('99.99')] },
    ]);
  });

  it('sorts by the lowest price, highest first, when asked', async () => {
    const { service, flightModel } = setup();
    await service.searchLeg(criteria({ sortOrder: SortOrder.DESC }));

    expect(pipelineOf(flightModel).slice(4)).toEqual([
      { $sort: { lowestPrice: -1, departureAtUtc: 1, _id: 1 } },
    ]);
  });

  it.each([
    [SortOrder.ASC, 1],
    [SortOrder.DESC, -1],
  ])('sorts by departure time (%s)', async (sortOrder, direction) => {
    const { service, flightModel } = setup();
    await service.searchLeg(
      criteria({ sortBy: FlightSortBy.DEPARTURE_TIME, sortOrder }),
    );

    expect(pipelineOf(flightModel).slice(4)).toEqual([
      { $sort: { departureAtUtc: direction, _id: 1 } },
    ]);
  });

  it('sorts by a duration it computes and then removes', async () => {
    const { service, flightModel } = setup();
    await service.searchLeg(criteria({ sortBy: FlightSortBy.DURATION }));

    expect(pipelineOf(flightModel).slice(4)).toEqual([
      {
        $addFields: {
          durationMs: { $subtract: ['$arrivalAtUtc', '$departureAtUtc'] },
        },
      },
      { $sort: { durationMs: 1, departureAtUtc: 1, _id: 1 } },
      { $unset: 'durationMs' },
    ]);
  });

  it('never returns the seat counters', async () => {
    const { service, flightModel } = setup();
    await service.searchLeg(criteria());

    const projection = projectionOf(flightModel).$project;
    expect(projection).not.toHaveProperty('cabinInventory');
    expect(projection.cabins.$map.in).toEqual({
      category: '$$cabin.category',
      price: '$$cabin.price',
      freeSeats: FREE_SEATS,
      freeBaggageCount: '$$cabin.freeBaggageCount',
      maxBagWeightKg: '$$cabin.maxBagWeightKg',
    });
  });

  it('returns each flight as a search item, with local times at each airport', async () => {
    const { service } = setup();
    const result = await service.searchLeg(criteria());

    // JFK is on UTC-5 and CAI on UTC+2 in November.
    expect(result).toEqual([
      {
        id: FLIGHT_ID.toString(),
        airline: {
          id: AIRLINE_ID.toString(),
          name: 'EgyptAir',
          iataCode: 'MS',
        },
        flightNumber: 'MS986',
        departureAirportId: 'JFK',
        arrivalAirportId: 'CAI',
        departureLocalTime: '2026-11-20T22:00:00-05:00',
        arrivalLocalTime: '2026-11-21T16:30:00+02:00',
        departureAtUtc: '2026-11-21T03:00:00.000Z',
        arrivalAtUtc: '2026-11-21T14:30:00.000Z',
        durationMinutes: 690,
        lowestPrice: '450.00',
        cabins: [
          {
            category: CabinCategory.ECONOMY,
            pricePerSeat: '450.00',
            seatsAvailable: 40,
            freeBaggageCount: 1,
            maxBagWeightKg: 23,
          },
        ],
      },
    ]);
  });

  it('uses the time zone of the airport each flight lands at (ITN-26)', async () => {
    const { service } = setup({
      matches: [match({ arrivalAirportId: 'NRT' })],
    });
    const [flight] = await service.searchLeg(
      criteria({ arrivalAirportIds: ['CAI', 'NRT'] }),
    );

    expect(flight.arrivalLocalTime).toBe('2026-11-21T23:30:00+09:00');
  });
});

describe('FlightSearchService.search (FLT-12)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('searches only the outbound leg for a one-way trip, with seats for adults and children', async () => {
    const { service } = setup();
    const outbound = [searchItem('JL5')];
    const searchLeg = jest
      .spyOn(service, 'searchLeg')
      .mockResolvedValueOnce(outbound);

    const result = await service.search(
      searchQuery({
        adults: 2,
        children: 1,
        infants: 2,
        cabin: CabinCategory.BUSINESS,
        minPrice: '100',
        maxPrice: '900',
        sortBy: FlightSortBy.DURATION,
        sortOrder: SortOrder.DESC,
      }),
    );

    expect(searchLeg).toHaveBeenCalledTimes(1);
    expect(searchLeg).toHaveBeenCalledWith({
      departureAirportId: 'JFK',
      arrivalAirportIds: ['NRT'],
      departureDate: '2026-11-20',
      dateField: 'departureDate',
      // Infants need no seat.
      seats: 3,
      cabin: CabinCategory.BUSINESS,
      minPrice: '100',
      maxPrice: '900',
      sortBy: FlightSortBy.DURATION,
      sortOrder: SortOrder.DESC,
    });
    expect(result.outbound.items).toEqual(outbound);
    expect(result.inbound).toBeNull();
  });

  it('searches the return leg back between the same airports on returnDate', async () => {
    const { service } = setup();
    const searchLeg = jest
      .spyOn(service, 'searchLeg')
      .mockResolvedValueOnce([searchItem('JL5')])
      .mockResolvedValueOnce([searchItem('JL6')]);

    const result = await service.search(
      searchQuery({
        tripType: TripType.ROUND_TRIP,
        returnDate: '2026-11-27',
        cabin: CabinCategory.ECONOMY,
        maxPrice: '900',
      }),
    );

    expect(searchLeg).toHaveBeenCalledTimes(2);
    expect(searchLeg).toHaveBeenLastCalledWith({
      departureAirportId: 'NRT',
      arrivalAirportIds: ['JFK'],
      departureDate: '2026-11-27',
      dateField: 'returnDate',
      seats: 1,
      cabin: CabinCategory.ECONOMY,
      minPrice: undefined,
      maxPrice: '900',
      sortBy: FlightSortBy.PRICE,
      sortOrder: SortOrder.ASC,
    });
    expect(result.inbound?.items.map((f) => f.flightNumber)).toEqual(['JL6']);
  });

  it('pages each leg on its own: page for outbound, returnPage for inbound', async () => {
    const { service } = setup();
    const numbered = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => searchItem(`${prefix}${i + 1}`));
    jest
      .spyOn(service, 'searchLeg')
      .mockResolvedValueOnce(numbered('OUT', 12))
      .mockResolvedValueOnce(numbered('IN', 15));

    const result = await service.search(
      searchQuery({
        tripType: TripType.ROUND_TRIP,
        returnDate: '2026-11-27',
        page: 2,
        returnPage: 1,
      }),
    );

    expect(result.outbound.items.map((f) => f.flightNumber)).toEqual([
      'OUT11',
      'OUT12',
    ]);
    expect(result.outbound.meta).toMatchObject({ page: 2, totalItems: 12 });
    expect(result.inbound?.items).toHaveLength(10);
    expect(result.inbound?.meta).toMatchObject({
      page: 1,
      totalItems: 15,
      totalPages: 2,
    });
  });

  it('does not search the return leg when the outbound leg fails', async () => {
    const { service } = setup();
    const searchLeg = jest
      .spyOn(service, 'searchLeg')
      .mockRejectedValueOnce(
        new BadRequestException({ code: 'UNKNOWN_AIRPORT' }),
      );

    const error = await failure(
      service.search(
        searchQuery({
          tripType: TripType.ROUND_TRIP,
          returnDate: '2026-11-27',
        }),
      ),
    );

    expect(error.getResponse()).toMatchObject({ code: 'UNKNOWN_AIRPORT' });
    expect(searchLeg).toHaveBeenCalledTimes(1);
  });

  it('rejects a return date already past at the return airport, on returnDate', async () => {
    const { service } = setup();
    // Still the 20th in New York, already the 21st in Tokyo, where the return flight leaves.
    const error = await failure(
      service.search(
        searchQuery({
          tripType: TripType.ROUND_TRIP,
          departureDate: '2026-11-20',
          returnDate: '2026-11-20',
        }),
      ),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: 'DEPARTURE_DATE_IN_PAST',
      message: 'returnDate must not be before today at NRT',
      errors: [
        {
          field: 'returnDate',
          messages: ['returnDate must not be before today at NRT'],
        },
      ],
    });
  });
});
