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
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import {
  ItineraryDto,
  ItinerarySummaryDto,
} from './dto/itinerary-response.dto';
import { ItinerariesService } from './itineraries.service';

@ApiTags('Itineraries')
// TEMPORARY: remove this header once the Auth module is merged.
@ApiHeader({
  name: 'x-dev-user-id',
  description: 'TEMPORARY dev user id (a 24-hex ObjectId) until auth is merged',
  required: false,
})
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Post()
  @ApiOperation({ summary: 'Create an itinerary (ITN-01)' })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  create(@CurrentUserId() userId: string, @Body() dto: CreateItineraryDto) {
    return this.itineraries.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List my itineraries, most recently updated first (ITN-03)',
  })
  @ApiPaginatedResponse(ItinerarySummaryDto)
  list(@CurrentUserId() userId: string, @Query() query: PaginationQueryDto) {
    return this.itineraries.list(userId, query.page);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my itineraries (ITN-03)' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.itineraries.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit title, countries or start date (ITN-01)' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateItineraryDto,
  ) {
    return this.itineraries.update(userId, id, dto);
  }

  @Patch(':id/visibility')
  @ApiOperation({ summary: 'Set Public or Private (ITN-20)' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  setVisibility(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: SetVisibilityDto,
  ) {
    return this.itineraries.setVisibility(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an itinerary (ITN-01)' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async remove(@CurrentUserId() userId: string, @Param('id') id: string) {
    await this.itineraries.remove(userId, id);
  }
}
