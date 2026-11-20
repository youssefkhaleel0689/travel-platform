import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  HotelSearchDto,
  HotelSortBy,
  SortOrder,
} from '../../hotel-search/dto/hotel-search.dto';
import type { HotelSearchService } from '../../hotel-search/hotel-search.service';
import type { ItinerariesService } from '../itineraries.service';
import { ItineraryHotelSearchQueryDto } from './dto/itinerary-hotel-search-query.dto';
import { ItineraryHotelsService } from './itinerary-hotels.service';

const ITINERARY_ID = '6720f1c2a1b2c3d4e5f60718';
const USER: AuthenticatedUser = {
  userId: '6720f1c2a1b2c3d4e5f60700',
  role: Role.USER,
  sessionId: '6720f1c2a1b2c3d4e5f60799',
};

// Starts on 20 Dec 2026: two days in Cairo, one in Dubai, two in Paris. Groups:
// 1 = cairo (20-21), 2 = dubai (22), 3 = paris (23-24).
function itinerary(cities = ['cairo', 'cairo', 'dubai', 'paris', 'paris']) {
  return {
    _id: new Types.ObjectId(ITINERARY_ID),
    startDate: new Date('2026-12-20T00:00:00.000Z'),
    days: cities.map((city) => ({ _id: new Types.ObjectId(), city })),
  };
}

function query(
  overrides: Partial<ItineraryHotelSearchQueryDto> = {},
): ItineraryHotelSearchQueryDto {
  return Object.assign(new ItineraryHotelSearchQueryDto(), {
    cityGroup: 1,
    guestCount: 2,
    ...overrides,
  });
}

// What HotelSearchService.search answers: only its shape matters here.
const searchResult = {
  checkInDate: new Date('2026-12-20T00:00:00.000Z'),
  checkOutDate: new Date('2026-12-22T00:00:00.000Z'),
  nights: 2,
  guestCount: 2,
  roomCount: 1,
  items: [{ hotelId: 'hotel-1' }],
  meta: { page: 1, totalItems: 1 },
} as never;

function setup(
  options: { itinerary?: ReturnType<typeof itinerary> | null } = {},
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
  const hotelSearch = { search: jest.fn().mockResolvedValue(searchResult) };
  const service = new ItineraryHotelsService(
    itineraries as unknown as ItinerariesService,
    hotelSearch as unknown as HotelSearchService,
  );
  return { service, itineraries, hotelSearch };
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

/** The HotelSearchDto the service handed to search. */
function searchedWith(hotelSearch: { search: jest.Mock }): HotelSearchDto {
  const [dto] = hotelSearch.search.mock.calls[0] as [HotelSearchDto];
  return dto;
}

describe('ItineraryHotelsService (ITN-25)', () => {
  it('checks ownership, searches the first group and wraps the result', async () => {
    const { service, itineraries, hotelSearch } = setup();

    const result = await service.search(ITINERARY_ID, USER, query());

    expect(itineraries.findOwnedOrThrow).toHaveBeenCalledWith(
      USER,
      ITINERARY_ID,
    );
    expect(hotelSearch.search).toHaveBeenCalledTimes(1);
    const dto = searchedWith(hotelSearch);
    expect(dto).toBeInstanceOf(HotelSearchDto);
    expect(dto).toMatchObject({
      cityId: 'cairo',
      checkInDate: '2026-12-20',
      checkOutDate: '2026-12-22',
      guestCount: 2,
      roomCount: 1,
      page: 1,
    });
    expect(dto.countryId).toBeUndefined();
    expect(result).toEqual({
      itineraryId: ITINERARY_ID,
      cityGroup: {
        index: 1,
        city: 'cairo',
        fromDay: 1,
        toDay: 2,
        checkInDate: '2026-12-20',
        checkOutDate: '2026-12-22',
      },
      ...(searchResult as object),
    });
  });

  it('checks out the next day for a one-day group in the middle of the itinerary', async () => {
    const { service, hotelSearch } = setup();

    const result = await service.search(
      ITINERARY_ID,
      USER,
      query({ cityGroup: 2 }),
    );

    expect(searchedWith(hotelSearch)).toMatchObject({
      cityId: 'dubai',
      checkInDate: '2026-12-22',
      checkOutDate: '2026-12-23',
    });
    expect(result.cityGroup).toEqual({
      index: 2,
      city: 'dubai',
      fromDay: 3,
      toDay: 3,
      checkInDate: '2026-12-22',
      checkOutDate: '2026-12-23',
    });
  });

  it('numbers groups like GET /api/itineraries/:id: a city that comes back is a new group', async () => {
    const { service, hotelSearch } = setup({
      itinerary: itinerary(['cairo', 'dubai', 'cairo']),
    });

    await service.search(ITINERARY_ID, USER, query({ cityGroup: 3 }));

    expect(searchedWith(hotelSearch)).toMatchObject({
      cityId: 'cairo',
      checkInDate: '2026-12-22',
      checkOutDate: '2026-12-23',
    });
  });

  it('checks out across the year end for the last group', async () => {
    const { service, hotelSearch } = setup({
      itinerary: {
        ...itinerary(['paris', 'paris']),
        startDate: new Date('2026-12-30T00:00:00.000Z'),
      },
    });

    await service.search(ITINERARY_ID, USER, query());

    expect(searchedWith(hotelSearch)).toMatchObject({
      checkInDate: '2026-12-30',
      checkOutDate: '2027-01-01',
    });
  });

  it('forwards the guests, rooms, filters, sorting and page unchanged', async () => {
    const { service, hotelSearch } = setup();

    await service.search(
      ITINERARY_ID,
      USER,
      query({
        guestCount: 5,
        roomCount: 3,
        minPricePerNight: '50',
        maxPricePerNight: '200.50',
        minAverageRating: 4,
        sortBy: HotelSortBy.RATING,
        sortOrder: SortOrder.ASC,
        page: 2,
      }),
    );

    expect(searchedWith(hotelSearch)).toMatchObject({
      guestCount: 5,
      roomCount: 3,
      minPricePerNight: '50',
      maxPricePerNight: '200.50',
      minAverageRating: 4,
      sortBy: HotelSortBy.RATING,
      sortOrder: SortOrder.ASC,
      page: 2,
    });
  });

  it('answers 409 ITINERARY_HAS_NO_DAYS without searching', async () => {
    const { service, hotelSearch } = setup({ itinerary: itinerary([]) });

    const error = await failure(service.search(ITINERARY_ID, USER, query()));

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      code: 'ITINERARY_HAS_NO_DAYS',
      message: 'Add a day with a city to the itinerary before searching hotels',
    });
    expect(hotelSearch.search).not.toHaveBeenCalled();
  });

  it('answers 400 UNKNOWN_CITY_GROUP naming how many groups exist', async () => {
    const { service, hotelSearch } = setup();

    const error = await failure(
      service.search(ITINERARY_ID, USER, query({ cityGroup: 4 })),
    );

    const message =
      'cityGroup must be between 1 and 3: this itinerary has 3 city groups';
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: 'UNKNOWN_CITY_GROUP',
      message,
      errors: [{ field: 'cityGroup', messages: [message] }],
    });
    expect(hotelSearch.search).not.toHaveBeenCalled();
  });

  it('says "1 city group" when there is only one', async () => {
    const { service } = setup({ itinerary: itinerary(['cairo', 'cairo']) });

    const error = await failure(
      service.search(ITINERARY_ID, USER, query({ cityGroup: 2 })),
    );

    expect((error.getResponse() as { message: string }).message).toBe(
      'cityGroup must be between 1 and 1: this itinerary has 1 city group',
    );
  });

  it("passes the itinerary's 404 through without searching", async () => {
    const { service, hotelSearch } = setup({ itinerary: null });

    const error = await failure(service.search(ITINERARY_ID, USER, query()));

    expect(error.getStatus()).toBe(404);
    expect(hotelSearch.search).not.toHaveBeenCalled();
  });

  it("passes search's own 400 through, e.g. a check-in in the past", async () => {
    const { service, hotelSearch } = setup();
    const past = new BadRequestException('checkInDate cannot be in the past');
    hotelSearch.search.mockRejectedValue(past);

    await expect(service.search(ITINERARY_ID, USER, query())).rejects.toBe(
      past,
    );
  });
});
