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
  ITINERARY_HAS_NO_DAYS,
  ItineraryHotelsService,
} from './itinerary-hotels.service';

const PATH = `${ITINERARY_PATH}/hotels`;

// ITN-25: hotel search for one city group of the itinerary. Under /itineraries
// with the same auth and ownership answers as the other itinerary routes.
@ApiTags('Itineraries')
@ApiItineraryAuth(PATH)
@Controller('itineraries')
export class ItineraryHotelsController {
  constructor(private readonly itineraryHotels: ItineraryHotelsService) {}

  @Get(':id/hotels')
  @ApiOperation({
    summary: 'Search hotels for one city group of the itinerary (ITN-25)',
    description:
      'Pick a city group by its number (see cityGroups on the itinerary). The stay ' +
      "is that group's dates: check-in on its first day, check-out the day after its " +
      'last day. guestCount and roomCount are yours to enter; price, rating, sorting ' +
      'and paging work as in GET /api/hotels/search, which this reuses.',
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
        code: 'INVALID_CITY_GROUP',
        message: 'group must be between 1 and 2, the number of city groups',
      },
      { code: 'BAD_REQUEST', message: 'checkInDate cannot be in the past' },
    ),
  )
  @ApiErrorResponse(notFoundError(PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  @ApiErrorResponse({
    status: 409,
    description: 'The itinerary has no day yet, so it has no city group',
    examples: [{ ...ITINERARY_HAS_NO_DAYS, path: PATH }],
  })
  search(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ItineraryHotelSearchQueryDto,
  ): Promise<ItineraryHotelSearchResponseDto> {
    return this.itineraryHotels.search(id, user, query);
  }
}
