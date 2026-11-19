import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { HotelSearchDto } from '../../hotel-search/dto/hotel-search.dto';
import { HotelSearchService } from '../../hotel-search/hotel-search.service';
import { ItinerariesService } from '../itineraries.service';
import { dateOfDay, groupConsecutiveDays } from '../itinerary-days.logic';
import type { ItineraryHotelSearchQueryDto } from './dto/itinerary-hotel-search-query.dto';
import type { ItineraryHotelSearchResponseDto } from './dto/itinerary-hotel-search-response.dto';

export const ITINERARY_HAS_NO_DAYS = {
  code: 'ITINERARY_HAS_NO_DAYS',
  message: 'Add a day with a city to the itinerary before searching hotels',
} as const;

/**
 * ITN-25: hotels available for one city group of the itinerary (ITN-09). The
 * stay is the group's dates: check-in on its first day, check-out the day after
 * its last day. The search itself is hotel search (HTL-11, HTL-12), unchanged.
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
  ): Promise<ItineraryHotelSearchResponseDto> {
    // Ownership check (ACC-11): someone else's itinerary is the same 404 as none.
    const itinerary = await this.itineraries.findOwnedOrThrow(
      user,
      itineraryId,
    );
    if (itinerary.days.length === 0) {
      throw new ConflictException(ITINERARY_HAS_NO_DAYS);
    }

    const groups = groupConsecutiveDays(
      itinerary.days.map((d) => ({ id: d._id.toString(), city: d.city })),
      itinerary.startDate,
    );
    if (query.group > groups.length) {
      const message = `group must be between 1 and ${groups.length}, the number of city groups`;
      throw new BadRequestException({
        code: 'INVALID_CITY_GROUP',
        message,
        errors: [{ field: 'group', messages: [message] }],
      });
    }
    const chosen = groups[query.group - 1];
    const checkInDate = chosen.startDate;
    // toDay is 1-based, so as a 0-based index it is already the day after.
    const checkOutDate = dateOfDay(itinerary.startDate, chosen.toDay);

    const hotelQuery = Object.assign(new HotelSearchDto(), {
      cityId: chosen.city,
      checkInDate,
      checkOutDate,
      guestCount: query.guestCount,
      roomCount: query.roomCount,
      sortBy: query.sortBy,
      page: query.page,
      ...(query.minPricePerNight !== undefined && {
        minPricePerNight: query.minPricePerNight,
      }),
      ...(query.maxPricePerNight !== undefined && {
        maxPricePerNight: query.maxPricePerNight,
      }),
      ...(query.minAverageRating !== undefined && {
        minAverageRating: query.minAverageRating,
      }),
      ...(query.sortOrder !== undefined && { sortOrder: query.sortOrder }),
    });
    const result = await this.hotelSearch.search(hotelQuery);

    return {
      cityGroup: {
        group: query.group,
        city: chosen.city,
        fromDay: chosen.fromDay,
        toDay: chosen.toDay,
        checkInDate,
        checkOutDate,
      },
      nights: result.nights,
      guestCount: query.guestCount,
      roomCount: query.roomCount,
      items: result.items.map((h) => ({
        hotelId: String(h.hotelId),
        name: h.name,
        address: h.address,
        cityId: h.cityId,
        countryId: h.countryId,
        starClass: h.starClass,
        ratingAverage: h.ratingAverage,
        ratingCount: h.ratingCount,
        pricePerNight: h.pricePerNight,
        freeRoomCount: h.freeRoomCount,
      })),
      meta: result.meta,
    };
  }
}
