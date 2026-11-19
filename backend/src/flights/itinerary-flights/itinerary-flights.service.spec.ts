import { HttpException, NotFoundException } from '@nestjs/common';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import type { ItinerariesService } from '../../itineraries/itineraries.service';
import {
  FlightSortBy,
  SortOrder,
  TripType,
} from '../flight-search/flight-search.constants';
import type { FlightSearchService } from '../flight-search/flight-search.service';
import { CabinCategory } from '../schemas/flight.schema';
import { ItineraryFlightSearchQueryDto } from './dto/itinerary-flight-search-query.dto';
import { ItineraryFlightsService } from './itinerary-flights.service';

const ITINERARY_ID = '6720f1c2a1b2c3d4e5f60718';
const USER: AuthenticatedUser = {
  userId: '6720f1c2a1b2c3d4e5f60700',
  role: Role.USER,
  sessionId: '6720f1c2a1b2c3d4e5f60799',
};

// Starts on 20 Dec 2026 in Dubai, then two days in Abu Dhabi: the last day is the 22nd.
function itinerary(cities = ['dubai', 'abu-dhabi', 'abu-dhabi']) {
  return {
    startDate: new Date('2026-12-20T00:00:00.000Z'),
    days: cities.map((city) => ({ city })),
  };
}

function query(
  overrides: Partial<ItineraryFlightSearchQueryDto> = {},
): ItineraryFlightSearchQueryDto {
  return Object.assign(new ItineraryFlightSearchQueryDto(), {
    originAirportId: 'CAI',
    ...overrides,
  });
}

// A search result: only its id matters here.
const flight = (id: string) => ({ id }) as never;

function setup(
  options: {
    itinerary?: ReturnType<typeof itinerary> | null;
    airports?: string[];
  } = {},
) {
  const found =
    options.itinerary === undefined ? itinerary() : options.itinerary;
  const itineraries = {
    findOwnedOrThrow: jest.fn(() =>
      found
        ? Promise.resolve(found)
        : Promise.reject(
            new NotFoundException({
              code: 'ITINERARY_NOT_FOUND',
              message: 'Itinerary not found',
            }),
          ),
    ),
  };
  const referenceData = {
    listAirportIdsInCity: jest.fn(() =>
      Promise.resolve(options.airports ?? ['DWC', 'DXB']),
    ),
  };
  const flightSearch = {
    searchLeg: jest
      .fn()
      .mockResolvedValueOnce([flight('out-1'), flight('out-2')])
      .mockResolvedValueOnce([flight('back-1')]),
  };
  const service = new ItineraryFlightsService(
    itineraries as unknown as ItinerariesService,
    referenceData as unknown as ReferenceDataService,
    flightSearch as unknown as FlightSearchService,
  );
  return { service, itineraries, referenceData, flightSearch };
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

describe('ItineraryFlightsService (ITN-26)', () => {
  it("flies one way to every airport of the first day's city, on the start date", async () => {
    const { service, itineraries, referenceData, flightSearch } = setup();

    const result = await service.search(ITINERARY_ID, USER, query());

    expect(itineraries.findOwnedOrThrow).toHaveBeenCalledWith(
      USER,
      ITINERARY_ID,
    );
    expect(referenceData.listAirportIdsInCity).toHaveBeenCalledWith('dubai');
    expect(flightSearch.searchLeg).toHaveBeenCalledTimes(1);
    expect(flightSearch.searchLeg).toHaveBeenCalledWith({
      seats: 1,
      cabin: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      sortBy: FlightSortBy.PRICE,
      sortOrder: SortOrder.ASC,
      departureAirportIds: ['CAI'],
      arrivalAirportIds: ['DWC', 'DXB'],
      departureDate: '2026-12-20',
      dateField: 'departureDate',
    });
    expect(result).toEqual({
      destinationCityId: 'dubai',
      destinationAirportIds: ['DWC', 'DXB'],
      departureDate: '2026-12-20',
      returnDate: null,
      outbound: {
        items: [flight('out-1'), flight('out-2')],
        meta: expect.objectContaining({ page: 1 }) as object,
      },
      inbound: null,
    });
  });

  it("flies back from any of the city's airports on the last day for a round trip", async () => {
    const { service, flightSearch } = setup();

    const result = await service.search(
      ITINERARY_ID,
      USER,
      query({ tripType: TripType.ROUND_TRIP }),
    );

    expect(flightSearch.searchLeg).toHaveBeenLastCalledWith(
      expect.objectContaining({
        departureAirportIds: ['DWC', 'DXB'],
        arrivalAirportIds: ['CAI'],
        departureDate: '2026-12-22',
        dateField: 'returnDate',
      }),
    );
    expect(result.returnDate).toBe('2026-12-22');
    expect(result.inbound?.items).toEqual([flight('back-1')]);
  });

  it('uses the dates, passengers and filters the user chose', async () => {
    const { service, flightSearch } = setup();

    const result = await service.search(
      ITINERARY_ID,
      USER,
      query({
        tripType: TripType.ROUND_TRIP,
        departureDate: '2026-12-19',
        returnDate: '2026-12-23',
        adults: 2,
        children: 1,
        infants: 1,
        cabin: CabinCategory.BUSINESS,
        minPrice: '100',
        maxPrice: '900.50',
        sortBy: FlightSortBy.DURATION,
        sortOrder: SortOrder.DESC,
      }),
    );

    expect(flightSearch.searchLeg).toHaveBeenNthCalledWith(1, {
      seats: 3,
      cabin: CabinCategory.BUSINESS,
      minPrice: '100',
      maxPrice: '900.50',
      sortBy: FlightSortBy.DURATION,
      sortOrder: SortOrder.DESC,
      departureAirportIds: ['CAI'],
      arrivalAirportIds: ['DWC', 'DXB'],
      departureDate: '2026-12-19',
      dateField: 'departureDate',
    });
    expect(result).toMatchObject({
      departureDate: '2026-12-19',
      returnDate: '2026-12-23',
    });
  });

  it('answers 409 when the itinerary has no day yet', async () => {
    const { service, flightSearch } = setup({ itinerary: itinerary([]) });

    const error = await failure(service.search(ITINERARY_ID, USER, query()));

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      code: 'ITINERARY_HAS_NO_DAYS',
      message:
        'Add a day with a city to the itinerary before searching flights',
    });
    expect(flightSearch.searchLeg).not.toHaveBeenCalled();
  });

  it('answers 409 when the first city has no airport', async () => {
    const { service } = setup({ airports: [] });

    const error = await failure(service.search(ITINERARY_ID, USER, query()));

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      code: 'NO_AIRPORT_IN_CITY',
      message: "The itinerary's first city (dubai) has no airport",
    });
  });

  it('refuses an origin inside the destination city', async () => {
    const { service, flightSearch } = setup();

    const error = await failure(
      service.search(ITINERARY_ID, USER, query({ originAirportId: 'DXB' })),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({
      code: 'ORIGIN_IN_DESTINATION_CITY',
      errors: [{ field: 'originAirportId' }],
    });
    expect(flightSearch.searchLeg).not.toHaveBeenCalled();
  });

  it('refuses a departure after the last day when the return date is the default', async () => {
    const { service } = setup();

    const error = await failure(
      service.search(
        ITINERARY_ID,
        USER,
        query({ tripType: TripType.ROUND_TRIP, departureDate: '2026-12-30' }),
      ),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: 'RETURN_BEFORE_DEPARTURE',
      message:
        "returnDate (2026-12-22, the itinerary's last day) must not be before departureDate (2026-12-30)",
      errors: [
        {
          field: 'returnDate',
          messages: [
            "returnDate (2026-12-22, the itinerary's last day) must not be before departureDate (2026-12-30)",
          ],
        },
      ],
    });
  });

  it("passes on the itinerary's 404 for someone else's itinerary", async () => {
    const { service } = setup({ itinerary: null });

    const error = await failure(service.search(ITINERARY_ID, USER, query()));

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({ code: 'ITINERARY_NOT_FOUND' });
  });
});
