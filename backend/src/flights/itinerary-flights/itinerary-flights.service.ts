import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginateArray } from '../../common/pagination/paginate';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { ItinerariesService } from '../../itineraries/itineraries.service';
import { dateOfDay } from '../../itineraries/itinerary-days.logic';
import { TripType } from '../flight-search/flight-search.constants';
import { FlightSearchService } from '../flight-search/flight-search.service';
import type { ItineraryFlightSearchQueryDto } from './dto/itinerary-flight-search-query.dto';
import type { ItineraryFlightSearchResponseDto } from './dto/itinerary-flight-search-response.dto';

/**
 * ITN-26: flights from an origin airport to any airport in the city of the itinerary's
 * first day, one way or round trip. The dates default to the itinerary's first and last
 * days, and the search itself is FLT-11/FLT-12's searchLeg, unchanged.
 */
@Injectable()
export class ItineraryFlightsService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
    private readonly flightSearch: FlightSearchService,
  ) {}

  async search(
    itineraryId: string,
    user: AuthenticatedUser,
    query: ItineraryFlightSearchQueryDto,
  ): Promise<ItineraryFlightSearchResponseDto> {
    // D1's ownership check (ACC-11): someone else's itinerary is the same 404 as none.
    const itinerary = await this.itineraries.findOwnedOrThrow(
      user,
      itineraryId,
    );
    if (itinerary.days.length === 0) {
      throw new ConflictException({
        code: 'ITINERARY_HAS_NO_DAYS',
        message:
          'Add a day with a city to the itinerary before searching flights',
      });
    }

    const destinationCityId = itinerary.days[0].city;
    const destinationAirportIds =
      await this.referenceData.listAirportIdsInCity(destinationCityId);
    if (destinationAirportIds.length === 0) {
      throw new ConflictException({
        code: 'NO_AIRPORT_IN_CITY',
        message: `The itinerary's first city (${destinationCityId}) has no airport`,
      });
    }
    if (destinationAirportIds.includes(query.originAirportId)) {
      const message = `originAirportId must not be in ${destinationCityId}, the itinerary's first city`;
      throw new BadRequestException({
        code: 'ORIGIN_IN_DESTINATION_CITY',
        message,
        errors: [{ field: 'originAirportId', messages: [message] }],
      });
    }

    const departureDate =
      query.departureDate ?? dateOfDay(itinerary.startDate, 0);
    const returnDate =
      query.tripType === TripType.ROUND_TRIP
        ? (query.returnDate ??
          dateOfDay(itinerary.startDate, itinerary.days.length - 1))
        : null;
    // Only possible with a default: an explicit pair is checked by the DTO already.
    if (returnDate !== null && returnDate < departureDate) {
      const message = `returnDate (${returnDate}, the itinerary's last day) must not be before departureDate (${departureDate})`;
      throw new BadRequestException({
        code: 'RETURN_BEFORE_DEPARTURE',
        message,
        errors: [{ field: 'returnDate', messages: [message] }],
      });
    }

    const shared = {
      // Infants sit on an adult's lap, so only adults and children need seats (FLT-12).
      seats: query.adults + query.children,
      cabin: query.cabin,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };
    const outbound = await this.flightSearch.searchLeg({
      ...shared,
      departureAirportIds: [query.originAirportId],
      arrivalAirportIds: destinationAirportIds,
      departureDate,
      dateField: 'departureDate',
    });
    const inbound =
      returnDate === null
        ? null
        : await this.flightSearch.searchLeg({
            ...shared,
            departureAirportIds: destinationAirportIds,
            arrivalAirportIds: [query.originAirportId],
            departureDate: returnDate,
            dateField: 'returnDate',
          });

    return {
      destinationCityId,
      destinationAirportIds,
      departureDate,
      returnDate,
      outbound: paginateArray(outbound, query.page),
      inbound:
        inbound === null ? null : paginateArray(inbound, query.returnPage),
    };
  }
}
