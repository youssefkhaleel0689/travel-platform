import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import {
  ItineraryDto,
  ItinerarySummaryDto,
} from './dto/itinerary-response.dto';
import { ItinerariesService } from './itineraries.service';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  badRequestError,
  ITINERARY_NOT_FOUND_EXAMPLE,
  ITINERARY_PATH,
  notFoundError,
  UNKNOWN_COUNTRY,
} from './itinerary-api-docs';

@ApiTags('Itineraries')
@ApiItineraryAuth('/api/itineraries')
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an itinerary (ITN-01)',
    description:
      'Creates a private itinerary owned by the logged-in user. Countries must be seeded country codes.',
  })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiErrorResponse(
    badRequestError(
      '/api/itineraries',
      [
        {
          field: 'title',
          messages: ['title must be longer than or equal to 1 characters'],
        },
      ],
      UNKNOWN_COUNTRY,
    ),
  )
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateItineraryDto,
  ) {
    return this.itineraries.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List my itineraries, most recently updated first (ITN-03)',
  })
  @ApiPaginatedResponse(ItinerarySummaryDto)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.itineraries.list(user, query.page);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one of my itineraries (ITN-03)',
    description:
      'Owner only (ACC-11): another user’s itinerary answers 404 exactly like a missing one.',
  })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponse(notFoundError(ITINERARY_PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.itineraries.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit title, countries, start date or visibility (ITN-01, ITN-20)',
  })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponse(
    badRequestError(
      ITINERARY_PATH,
      [
        {
          field: 'startDate',
          messages: ['startDate must be a valid ISO 8601 date string'],
        },
      ],
      UNKNOWN_COUNTRY,
    ),
  )
  @ApiErrorResponse(notFoundError(ITINERARY_PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateItineraryDto,
  ) {
    return this.itineraries.update(user, id, dto);
  }

  @Patch(':id/visibility')
  @ApiOperation({ summary: 'Set Public or Private (ITN-20)' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponse(
    badRequestError(`${ITINERARY_PATH}/visibility`, [
      {
        field: 'visibility',
        messages: [
          'visibility must be one of the following values: private, public',
        ],
      },
    ]),
  )
  @ApiErrorResponse(
    notFoundError(`${ITINERARY_PATH}/visibility`, ITINERARY_NOT_FOUND_EXAMPLE),
  )
  setVisibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetVisibilityDto,
  ) {
    return this.itineraries.setVisibility(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an itinerary (ITN-01)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponse(notFoundError(ITINERARY_PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.itineraries.remove(user, id);
  }
}
