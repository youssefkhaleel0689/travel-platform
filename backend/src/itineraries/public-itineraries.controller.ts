import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUserId } from '../common/decorators/current-user-id.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PublicDetailQueryDto } from './dto/budget-summary-query.dto';
import { ItineraryDto } from './dto/itinerary-response.dto';
import { PublicItinerarySummaryDto } from './dto/public-itinerary-response.dto';
import { PublicSearchQueryDto } from './dto/public-search-query.dto';
import { PublicItinerariesService } from './public-itineraries.service';

@ApiTags('Itineraries - Public')
// TEMPORARY: remove this header once the Auth module is merged.
// Only "clone" needs it; search and view are open to guests.
@ApiHeader({
  name: 'x-dev-user-id',
  description: 'TEMPORARY dev user id (a 24-hex ObjectId) until auth is merged',
  required: false,
})
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@Controller('itineraries')
export class PublicItinerariesController {
  constructor(private readonly publicItineraries: PublicItinerariesService) {}

  @Get('public/search')
  @ApiOperation({
    summary:
      'Search public itineraries by keyword, country, city and duration (ITN-21)',
  })
  @ApiPaginatedResponse(PublicItinerarySummaryDto)
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  search(@Query() query: PublicSearchQueryDto) {
    return this.publicItineraries.search(query);
  }

  @Get('public/:id')
  @ApiOperation({
    summary:
      'View a public itinerary; add ?currency= to include its budget summary (ITN-21)',
  })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@Param('id') id: string, @Query() query: PublicDetailQueryDto) {
    return this.publicItineraries.findOne(id, query.currency);
  }

  @Post(':id/clone')
  @ApiOperation({
    summary:
      'Clone a public itinerary into my own private copy, keeping attribution (ITN-21)',
  })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  clone(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.publicItineraries.clone(userId, id);
  }
}
