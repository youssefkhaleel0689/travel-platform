import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { HotelSearchDto } from '../../hotel-search/dto/hotel-search.dto';
import { HotelSearchService } from '../../hotel-search/hotel-search.service';
import { ItinerariesService } from '../itineraries.service';
import { groupConsecutiveDays } from '../itinerary-days.logic';
import type { ItineraryHotelSearchQueryDto } from './dto/itinerary-hotel-search-query.dto';
import type { ItineraryHotelCityGroupDto } from './dto/itinerary-hotel-search-response.dto';
import { dayAfter } from './itinerary-hotels.logic';

/** What GET /api/hotels/search returns, unchanged. */
type HotelSearchResult = Awaited<ReturnType<HotelSearchService['search']>>;

/** The hotel search result, plus the itinerary and the city group it was made for. */
export type ItineraryHotelSearch = {
  itineraryId: string;
  cityGroup: ItineraryHotelCityGroupDto;
} & HotelSearchResult;

/**
 * ITN-25: hotels for one city group of an itinerary. The city and the dates come from
 * the group (check-in on its first day, check-out the day after its last day), and the
 * search itself is HTL-11/HTL-12's HotelSearchService.search, unchanged.
 */
@Injectable()
export class ItineraryHotelsService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly hotelSearch: HotelSearchService,
  ) {}

  async search(
    itineraryId: string,
    user: AuthenticatedUser,
    query: ItineraryHotelSearchQueryDto,
  ): Promise<ItineraryHotelSearch> {
    // D1's ownership check (ACC-11): someone else's itinerary is the same 404 as none.
    const itinerary = await this.itineraries.findOwnedOrThrow(
      user,
      itineraryId,
    );
    if (itinerary.days.length === 0) {
      throw new ConflictException({
        code: 'ITINERARY_HAS_NO_DAYS',
        message:
          'Add a day with a city to the itinerary before searching hotels',
      });
    }

    // The same call toItineraryView makes, so cityGroup N is the N-th group the user sees.
    const groups = groupConsecutiveDays(
      itinerary.days.map((day) => ({ id: day._id.toString(), city: day.city })),
      itinerary.startDate,
    );
    if (query.cityGroup > groups.length) {
      const message =
        `cityGroup must be between 1 and ${groups.length}: this itinerary has ` +
        `${groups.length} city group${groups.length === 1 ? '' : 's'}`;
      throw new BadRequestException({
        code: 'UNKNOWN_CITY_GROUP',
        message,
        errors: [{ field: 'cityGroup', messages: [message] }],
      });
    }

    const group = groups[query.cityGroup - 1];
    const checkInDate = group.startDate;
    const checkOutDate = dayAfter(group.endDate);

    // Everything else is forwarded as given; a check-in in the past is search's own 400.
    const result = await this.hotelSearch.search(
      Object.assign(new HotelSearchDto(), {
        cityId: group.city,
        checkInDate,
        checkOutDate,
        guestCount: query.guestCount,
        roomCount: query.roomCount,
        minPricePerNight: query.minPricePerNight,
        maxPricePerNight: query.maxPricePerNight,
        minAverageRating: query.minAverageRating,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
        page: query.page,
      }),
    );

    return {
      itineraryId: itinerary._id.toString(),
      cityGroup: {
        index: query.cityGroup,
        city: group.city,
        fromDay: group.fromDay,
        toDay: group.toDay,
        checkInDate,
        checkOutDate,
      },
      ...result,
    };
  }
}
