import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Public } from '../common/auth/public.decorator';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PublicDetailQueryDto } from './dto/budget-summary-query.dto';
import { ItineraryDto } from './dto/itinerary-response.dto';
import { PublicItinerarySummaryDto } from './dto/public-itinerary-response.dto';
import { PublicSearchQueryDto } from './dto/public-search-query.dto';
import { PublicItinerariesService } from './public-itineraries.service';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  badRequestError,
  EXAMPLE_ITINERARY_ID,
  EXCHANGE_RATES_UNAVAILABLE,
  notFoundError,
  UNKNOWN_CITY,
  UNKNOWN_COUNTRY,
  UNSUPPORTED_CURRENCY,
} from './itinerary-api-docs';

const SEARCH_PATH = '/api/itineraries/public/search';
const PUBLIC_PATH = `/api/itineraries/public/${EXAMPLE_ITINERARY_ID}`;
const CLONE_PATH = `/api/itineraries/${EXAMPLE_ITINERARY_ID}/clone`;
const PUBLIC_NOT_FOUND_EXAMPLE = {
  code: 'ITINERARY_NOT_FOUND',
  message: 'Public itinerary not found',
};

@ApiTags('Itineraries - Public')
@Controller('itineraries')
export class PublicItinerariesController {
  constructor(private readonly publicItineraries: PublicItinerariesService) {}

  @Get('public/search')
  @Public()
  @ApiOperation({
    summary:
      'Search public itineraries by keyword, country, city and duration (ITN-20, ITN-21)',
    description:
      'Open to guests. q matches the title, or a country or city by id or name.',
  })
  @ApiPaginatedResponse(PublicItinerarySummaryDto)
  @ApiErrorResponse(
    badRequestError(
      SEARCH_PATH,
      [
        {
          field: 'country',
          messages: ['country must be a 2-letter country code'],
        },
      ],
      {
        code: 'INVALID_DAY_RANGE',
        message: 'minDays cannot be greater than maxDays',
      },
      UNKNOWN_COUNTRY,
      UNKNOWN_CITY,
    ),
  )
  search(@Query() query: PublicSearchQueryDto) {
    return this.publicItineraries.search(query);
  }

  @Get('public/:id')
  @Public()
  @ApiOperation({
    summary:
      'View a public itinerary; add ?currency= to include its budget summary (ITN-21)',
    description:
      'Open to guests. A private itinerary answers 404 exactly like a missing one.',
  })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponse(
    badRequestError(
      PUBLIC_PATH,
      [
        {
          field: 'currency',
          messages: ['currency must be a 3-letter currency code'],
        },
      ],
      UNSUPPORTED_CURRENCY,
    ),
  )
  @ApiErrorResponse(notFoundError(PUBLIC_PATH, PUBLIC_NOT_FOUND_EXAMPLE))
  @ApiErrorResponse(EXCHANGE_RATES_UNAVAILABLE)
  findOne(@Param('id') id: string, @Query() query: PublicDetailQueryDto) {
    return this.publicItineraries.findOne(id, query.currency);
  }

  @Post(':id/clone')
  @ApiItineraryAuth(CLONE_PATH)
  @ApiOperation({
    summary:
      'Clone a public itinerary into my own private copy, keeping attribution (ITN-21)',
    description:
      'The copy is private, owned by the logged-in user, has new ids for every day and item, and records clonedFrom (itinerary and author).',
  })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiErrorResponse(notFoundError(CLONE_PATH, PUBLIC_NOT_FOUND_EXAMPLE))
  clone(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.publicItineraries.clone(user, id);
  }
}
