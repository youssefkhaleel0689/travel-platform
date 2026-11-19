import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  badRequestError,
  ITINERARY_NOT_FOUND_EXAMPLE,
  ITINERARY_PATH,
  notFoundError,
} from '../../itineraries/itinerary-api-docs';
import { ItineraryFlightSearchQueryDto } from './dto/itinerary-flight-search-query.dto';
import { ItineraryFlightSearchResponseDto } from './dto/itinerary-flight-search-response.dto';
import { ItineraryFlightsService } from './itinerary-flights.service';

const PATH = `${ITINERARY_PATH}/flights`;

// ITN-26: flight search from an itinerary. Under /itineraries like D1's routes, with the
// same auth and ownership answers, but owned by flights because it is a flight search.
@ApiTags('Itineraries')
@ApiItineraryAuth(PATH)
@Controller('itineraries')
export class ItineraryFlightsController {
  constructor(private readonly itineraryFlights: ItineraryFlightsService) {}

  @Get(':id/flights')
  @ApiOperation({
    summary: "Search flights to the itinerary's first city (ITN-26)",
    description:
      'One way or round trip from originAirportId to any airport in the city of the ' +
      "itinerary's first day. departureDate defaults to the itinerary's start date and " +
      "returnDate (ROUND_TRIP only) to its last day's date. Passengers, cabin, price " +
      'range, sorting and paging work as in GET /api/flights/search, which this reuses.',
  })
  @ApiOkResponse({ type: ItineraryFlightSearchResponseDto })
  @ApiErrorResponse(
    badRequestError(
      PATH,
      [
        {
          field: 'originAirportId',
          messages: [
            'originAirportId must be a 3-letter IATA code (for example CAI)',
          ],
        },
      ],
      { code: 'UNKNOWN_AIRPORT', message: 'Unknown airport: XXX' },
      {
        code: 'ORIGIN_IN_DESTINATION_CITY',
        message:
          "originAirportId must not be in dubai, the itinerary's first city",
      },
      {
        code: 'DEPARTURE_DATE_IN_PAST',
        message: 'departureDate must not be before today at CAI',
      },
      {
        code: 'RETURN_BEFORE_DEPARTURE',
        message:
          "returnDate (2026-12-27, the itinerary's last day) must not be before departureDate (2026-12-30)",
      },
    ),
  )
  @ApiErrorResponse(notFoundError(PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  @ApiErrorResponse({
    status: 409,
    description:
      'The itinerary has no day yet (ITINERARY_HAS_NO_DAYS), or its first city has no airport (NO_AIRPORT_IN_CITY)',
    examples: [
      {
        code: 'ITINERARY_HAS_NO_DAYS',
        message:
          'Add a day with a city to the itinerary before searching flights',
        path: PATH,
      },
      {
        code: 'NO_AIRPORT_IN_CITY',
        message: "The itinerary's first city (luxor) has no airport",
        path: PATH,
      },
    ],
  })
  search(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ItineraryFlightSearchQueryDto,
  ): Promise<ItineraryFlightSearchResponseDto> {
    return this.itineraryFlights.search(id, user, query);
  }
}
