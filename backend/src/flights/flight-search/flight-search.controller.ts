import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import { FlightSearchResponseDto } from './dto/flight-search-response.dto';
import { FlightSearchService } from './flight-search.service';

// FLT-11, FLT-12, FLT-15: flight search for guests and registered users.
@ApiTags('Flights')
@Controller('flights')
export class FlightSearchController {
  constructor(private readonly flightSearch: FlightSearchService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Search flights, one-way or round trip (FLT-11, FLT-12, FLT-15)',
    description:
      'Lists SCHEDULED flights of ACTIVE airlines that have not departed, on departureDate ' +
      'at the departure airport, with a cabin that has a free seat for every adult and ' +
      'child (infants sit on a lap). Only the matching cabins are returned. minPrice and ' +
      'maxPrice are inclusive and apply to the price per seat of each cabin. Results ' +
      'sort by lowestPrice, duration or departure time, 10 per page. A ROUND_TRIP also ' +
      'returns the flights back on returnDate, paged with returnPage. Empty items mean ' +
      'no flights were found.',
  })
  @ApiOkResponse({ type: FlightSearchResponseDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'Validation failed, an airport that is not seeded (UNKNOWN_AIRPORT), or a date ' +
      'before today at the airport the flight leaves from (DEPARTURE_DATE_IN_PAST)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/flights/search',
        errors: [
          {
            field: 'arrivalAirportId',
            messages: ['arrivalAirportId must differ from departureAirportId'],
          },
        ],
      },
      {
        code: 'UNKNOWN_AIRPORT',
        message: 'Unknown airport: XXX',
        path: '/api/flights/search',
      },
      {
        code: 'DEPARTURE_DATE_IN_PAST',
        message: 'departureDate must not be before today at CAI',
        path: '/api/flights/search',
        errors: [
          {
            field: 'departureDate',
            messages: ['departureDate must not be before today at CAI'],
          },
        ],
      },
    ],
  })
  search(
    @Query() query: FlightSearchQueryDto,
  ): Promise<FlightSearchResponseDto> {
    return this.flightSearch.search(query);
  }
}
