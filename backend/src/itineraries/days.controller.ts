import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CreateDayDto, ReorderDaysDto, UpdateDayDto } from './dto/day.dto';
import { ItineraryDto } from './dto/itinerary-response.dto';
import { DaysService } from './days.service';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  badRequestError,
  DAY_NOT_FOUND_EXAMPLE,
  EXAMPLE_DAY_ID,
  ITINERARY_NOT_FOUND_EXAMPLE,
  ITINERARY_PATH,
  notFoundError,
  UNKNOWN_CITY,
} from './itinerary-api-docs';

const DAYS_PATH = `${ITINERARY_PATH}/days`;
const DAY_PATH = `${DAYS_PATH}/${EXAMPLE_DAY_ID}`;

@ApiTags('Itineraries')
@ApiItineraryAuth(DAYS_PATH)
@Controller('itineraries')
export class DaysController {
  constructor(private readonly days: DaysService) {}

  @Post(':id/days')
  @ApiOperation({
    summary: 'Add a day at the end of the itinerary (ITN-05)',
    description:
      'Day numbers and dates are derived from the position and the start date, so they are never stored.',
  })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiErrorResponse(
    badRequestError(
      DAYS_PATH,
      [{ field: 'city', messages: ['city must be a city id such as paris'] }],
      UNKNOWN_CITY,
      {
        code: 'MAX_DAYS_REACHED',
        message: 'An itinerary can have at most 60 days',
      },
    ),
  )
  @ApiErrorResponse(notFoundError(DAYS_PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  addDay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateDayDto,
  ) {
    return this.days.addDay(user, id, dto);
  }

  // Must stay ABOVE ':id/days/:dayId', or "reorder" would be read as a day id.
  @Patch(':id/days/reorder')
  @ApiOperation({
    summary: 'Move a day to a new position (ITN-08)',
    description:
      'Numbers, dates, city groups and budgets follow the new order automatically.',
  })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponse(
    badRequestError(
      `${DAYS_PATH}/reorder`,
      [{ field: 'position', messages: ['position must not be less than 1'] }],
      { code: 'INVALID_POSITION', message: 'Position must be between 1 and 3' },
    ),
  )
  @ApiErrorResponse(
    notFoundError(
      `${DAYS_PATH}/reorder`,
      ITINERARY_NOT_FOUND_EXAMPLE,
      DAY_NOT_FOUND_EXAMPLE,
    ),
  )
  reorderDays(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReorderDaysDto,
  ) {
    return this.days.reorderDays(user, id, dto);
  }

  @Patch(':id/days/:dayId')
  @ApiOperation({ summary: 'Change a day city or notes (ITN-05)' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponse(
    badRequestError(
      DAY_PATH,
      [
        {
          field: 'notes',
          messages: ['notes must be shorter than or equal to 2000 characters'],
        },
      ],
      UNKNOWN_CITY,
    ),
  )
  @ApiErrorResponse(
    notFoundError(DAY_PATH, ITINERARY_NOT_FOUND_EXAMPLE, DAY_NOT_FOUND_EXAMPLE),
  )
  updateDay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: UpdateDayDto,
  ) {
    return this.days.updateDay(user, id, dayId, dto);
  }

  @Delete(':id/days/:dayId')
  @ApiOperation({
    summary:
      'Delete a day with its activities, budget entries and transport costs (ITN-07)',
    description: 'Later days move up one number and one date.',
  })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponse(
    notFoundError(DAY_PATH, ITINERARY_NOT_FOUND_EXAMPLE, DAY_NOT_FOUND_EXAMPLE),
  )
  deleteDay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
  ) {
    return this.days.deleteDay(user, id, dayId);
  }
}
