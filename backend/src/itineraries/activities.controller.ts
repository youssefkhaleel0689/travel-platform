import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { ActivityImageDto } from './dto/activity-image.dto';
import { ActivitiesService } from './activities.service';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  badRequestError,
  DAY_NOT_FOUND_EXAMPLE,
  EXAMPLE_ACTIVITY_ID,
  EXAMPLE_DAY_ID,
  ITINERARY_NOT_FOUND_EXAMPLE,
  ITINERARY_PATH,
  notFoundError,
  UNSUPPORTED_CURRENCY,
} from './itinerary-api-docs';

class ActivityDto {
  @ApiProperty({ example: EXAMPLE_ACTIVITY_ID })
  id: string;
  @ApiProperty({ example: 'Eiffel Tower visit' })
  name: string;
  @ApiProperty({ nullable: true, example: null, type: String })
  description: string | null;
  @ApiProperty({ nullable: true, example: '09:30', type: String })
  time: string | null;
  @ApiProperty({
    nullable: true,
    example: '25.50',
    type: String,
    description: 'Decimal string with 2 decimals, in `currency`',
  })
  cost: string | null;
  @ApiProperty({ nullable: true, example: 'EUR', type: String })
  currency: string | null;
  @ApiProperty({
    type: [ActivityImageDto],
    description:
      'Up to 5 images (ITN-12). Add them with POST /api/activities/{id}/images',
  })
  images: ActivityImageDto[];
}

const CREATE_PATH = `${ITINERARY_PATH}/days/${EXAMPLE_DAY_ID}/activities`;
const ACTIVITY_PATH = `/api/activities/${EXAMPLE_ACTIVITY_ID}`;
const ACTIVITY_NOT_FOUND_EXAMPLE = {
  code: 'ACTIVITY_NOT_FOUND',
  message: 'Activity not found',
};

@ApiTags('Itineraries - Activities')
@ApiItineraryAuth(ACTIVITY_PATH)
@Controller()
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Post('itineraries/:id/days/:dayId/activities')
  @ApiOperation({
    summary: 'Add an activity to a day (ITN-10)',
    description:
      'An optional cost needs a currency; it counts under "activities" in the budget summary (ITN-14).',
  })
  @ApiCreatedResponse({ type: ActivityDto })
  @ApiErrorResponse(
    badRequestError(
      CREATE_PATH,
      [{ field: 'time', messages: ['time must be HH:mm'] }],
      UNSUPPORTED_CURRENCY,
    ),
  )
  @ApiErrorResponse(
    notFoundError(
      CREATE_PATH,
      ITINERARY_NOT_FOUND_EXAMPLE,
      DAY_NOT_FOUND_EXAMPLE,
    ),
  )
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activities.create(user, id, dayId, dto);
  }

  @Patch('activities/:id')
  @ApiOperation({ summary: 'Edit an activity (ITN-10)' })
  @ApiOkResponse({ type: ActivityDto })
  @ApiErrorResponse(
    badRequestError(
      ACTIVITY_PATH,
      [{ field: 'cost', messages: ['cost must not be less than 0'] }],
      UNSUPPORTED_CURRENCY,
    ),
  )
  @ApiErrorResponse(notFoundError(ACTIVITY_PATH, ACTIVITY_NOT_FOUND_EXAMPLE))
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(user, id, dto);
  }

  @Delete('activities/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an activity (ITN-10)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponse(notFoundError(ACTIVITY_PATH, ACTIVITY_NOT_FOUND_EXAMPLE))
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.activities.remove(user, id);
  }
}
