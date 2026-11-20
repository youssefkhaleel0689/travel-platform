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
} from '../itinerary-api-docs';
import { ItineraryHotelSearchQueryDto } from './dto/itinerary-hotel-search-query.dto';
import { ItineraryHotelSearchResponseDto } from './dto/itinerary-hotel-search-response.dto';
import {
  ItineraryHotelSearch,
  ItineraryHotelsService,
} from './itinerary-hotels.service';

const PATH = `${ITINERARY_PATH}/hotels`;

// ITN-25: hotel search from an itinerary's city group. Under /itineraries like D1's
// routes and ITN-26, with the same auth and ownership answers.
@ApiTags('Itineraries')
@ApiItineraryAuth(PATH)
@Controller('itineraries')
export class ItineraryHotelsController {
  constructor(private readonly itineraryHotels: ItineraryHotelsService) {}

  @Get(':id/hotels')
  @ApiOperation({
    summary: "Search hotels for one of the itinerary's city groups (ITN-25)",
    description:
      'Hotels in the city of the chosen city group (cityGroups in GET ' +
      '/api/itineraries/:id, numbered from 1), with check-in on the date of its first ' +
      'day and check-out the day after its last day. Guests, rooms, price and rating ' +
      'filters, sorting and paging work as in GET /api/hotels/search, which this reuses.',
  })
  @ApiOkResponse({ type: ItineraryHotelSearchResponseDto })
  @ApiErrorResponse(
    badRequestError(
      PATH,
      [
        {
          field: 'guestCount',
          messages: ['guestCount must not be less than 1'],
        },
      ],
      {
        code: 'UNKNOWN_CITY_GROUP',
        message:
          'cityGroup must be between 1 and 2: this itinerary has 2 city groups',
      },
      {
        code: 'BAD_REQUEST',
        message: 'checkInDate cannot be in the past',
      },
    ),
  )
  @ApiErrorResponse(notFoundError(PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  @ApiErrorResponse({
    status: 409,
    description: 'The itinerary has no day yet (ITINERARY_HAS_NO_DAYS)',
    examples: [
      {
        code: 'ITINERARY_HAS_NO_DAYS',
        message:
          'Add a day with a city to the itinerary before searching hotels',
        path: PATH,
      },
    ],
  })
  search(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ItineraryHotelSearchQueryDto,
  ): Promise<ItineraryHotelSearch> {
    return this.itineraryHotels.search(id, user, query);
  }
}
