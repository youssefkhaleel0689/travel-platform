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
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUserId } from '../common/decorators/current-user-id.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { ActivitiesService } from './activities.service';

class ActivityDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60720' })
  id: string;
  @ApiProperty({ example: 'Eiffel Tower visit' })
  name: string;
  @ApiProperty({ nullable: true, example: null })
  description: string | null;
  @ApiProperty({ nullable: true, example: '09:30' })
  time: string | null;
  @ApiProperty({ nullable: true, example: 25.5 })
  cost: number | null;
  @ApiProperty({ nullable: true, example: 'EUR' })
  currency: string | null;
}

@ApiTags('Itineraries - Activities')
// TEMPORARY: remove this header once the Auth module is merged.
@ApiHeader({
  name: 'x-dev-user-id',
  description: 'TEMPORARY dev user id (a 24-hex ObjectId) until auth is merged',
  required: false,
})
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@Controller()
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Post('itineraries/:id/days/:dayId/activities')
  @ApiOperation({ summary: 'Add an activity to a day (ITN-10)' })
  @ApiCreatedResponse({ type: ActivityDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  create(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activities.create(userId, id, dayId, dto);
  }

  @Patch('activities/:id')
  @ApiOperation({ summary: 'Edit an activity (ITN-10)' })
  @ApiOkResponse({ type: ActivityDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(userId, id, dto);
  }

  @Delete('activities/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an activity (ITN-10)' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async remove(@CurrentUserId() userId: string, @Param('id') id: string) {
    await this.activities.remove(userId, id);
  }
}
