import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { HotelSearchService } from '../../hotel-search/hotel-search.service';
import type { ItinerariesService } from '../itineraries.service';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import { ItineraryHotelSearchQueryDto } from './dto/itinerary-hotel-search-query.dto';

const user = { userId: new Types.ObjectId().toString() } as AuthenticatedUser;

function itinerary(startDate: string, cities: string[]) {
  return {
    startDate: new Date(startDate),
    days: cities.map((city) => ({ _id: new Types.ObjectId(), city })),
  };
}

function setup(doc: ReturnType<typeof itinerary>) {
  const search = jest.fn().mockResolvedValue({
    nights: 0,
    items: [],
    meta: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
  });
  const service = new ItineraryHotelsService(
    {
      findOwnedOrThrow: jest.fn().mockResolvedValue(doc),
    } as unknown as ItinerariesService,
    { search } as unknown as HotelSearchService,
  );
  return { service, search };
}

const query = (
  group: number,
  extra: Partial<ItineraryHotelSearchQueryDto> = {},
) =>
  Object.assign(new ItineraryHotelSearchQueryDto(), {
    group,
    guestCount: 2,
    ...extra,
  });

describe('ItineraryHotelsService (ITN-25)', () => {
  it('uses the group city, its first day and the day after its last day', async () => {
    // Paris 30-31 Dec, London 1 Jan: the stay crosses the year end.
    const { service, search } = setup(
      itinerary('2026-12-30', ['paris', 'paris', 'london']),
    );
    const first = await service.search('id', user, query(1));
    expect(first.cityGroup).toEqual({
      group: 1,
      city: 'paris',
      fromDay: 1,
      toDay: 2,
      checkInDate: '2026-12-30',
      checkOutDate: '2027-01-01',
    });
    await service.search('id', user, query(2, { roomCount: 2 }));
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cityId: 'london',
        checkInDate: '2027-01-01',
        checkOutDate: '2027-01-02',
        guestCount: 2,
        roomCount: 2,
      }),
    );
  });

  it('keeps the defaults of hotel search and passes filters only when given', async () => {
    const { service, search } = setup(itinerary('2027-03-10', ['paris']));
    await service.search('id', user, query(1));
    const sent = search.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.roomCount).toBe(1);
    expect(sent.sortBy).toBe('price');
    expect(sent.page).toBe(1);
    expect(sent.minPricePerNight).toBeUndefined();
    expect(sent.sortOrder).toBeUndefined();
  });

  it('treats a return to the same city as a new group', async () => {
    const { service, search } = setup(
      itinerary('2027-03-10', ['paris', 'london', 'paris']),
    );
    await service.search('id', user, query(3));
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cityId: 'paris',
        checkInDate: '2027-03-12',
        checkOutDate: '2027-03-13',
      }),
    );
  });

  it('refuses an itinerary without days and a group that does not exist', async () => {
    await expect(
      setup(itinerary('2027-03-10', [])).service.search('id', user, query(1)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup(itinerary('2027-03-10', ['paris'])).service.search(
        'id',
        user,
        query(2),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
