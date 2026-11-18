import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
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
import { CreateDayDto, ReorderDaysDto, UpdateDayDto } from './dto/day.dto';
import { ItineraryDto } from './dto/itinerary-response.dto';
import { DaysService } from './days.service';

@ApiTags('Itineraries')
// TEMPORARY: remove this header once the Auth module is merged.
@ApiHeader({
  name: 'x-dev-user-id',
  description: 'TEMPORARY dev user id (a 24-hex ObjectId) until auth is merged',
  required: false,
})
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@Controller('itineraries')
export class DaysController {
  constructor(private readonly days: DaysService) {}

  @Post(':id/days')
  @ApiOperation({ summary: 'Add a day at the end of the itinerary (ITN-05)' })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  addDay(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: CreateDayDto,
  ) {
    return this.days.addDay(userId, id, dto);
  }

  // Must stay ABOVE ':id/days/:dayId', or "reorder" would be read as a day id.
  @Patch(':id/days/reorder')
  @ApiOperation({ summary: 'Move a day to a new position (ITN-08)' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  reorderDays(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: ReorderDaysDto,
  ) {
    return this.days.reorderDays(userId, id, dto);
  }

  @Patch(':id/days/:dayId')
  @ApiOperation({ summary: 'Change a day city or notes (ITN-05)' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  updateDay(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: UpdateDayDto,
  ) {
    return this.days.updateDay(userId, id, dayId, dto);
  }

  @Delete(':id/days/:dayId')
  @ApiOperation({
    summary:
      'Delete a day with its activities, budget entries and transport costs (ITN-07)',
  })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  deleteDay(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
  ) {
    return this.days.deleteDay(userId, id, dayId);
  }
}
