import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUserId } from '../common/decorators/current-user-id.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { BudgetSummaryQueryDto } from './dto/budget-summary-query.dto';
import { ItineraryBudgetSummaryService } from './itinerary-budget-summary.service';

@ApiTags('Itineraries - Budget')
// TEMPORARY: remove this header once the Auth module is merged.
@ApiHeader({
  name: 'x-dev-user-id',
  description: 'TEMPORARY dev user id (a 24-hex ObjectId) until auth is merged',
  required: false,
})
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@Controller('itineraries')
export class BudgetSummaryController {
  constructor(private readonly summaries: ItineraryBudgetSummaryService) {}

  @Get(':id/budget-summary')
  @ApiOperation({
    summary:
      'Budget totals by category, day and city, converted to one currency (ITN-14, ITN-18)',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  budgetSummary(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Query() query: BudgetSummaryQueryDto,
  ) {
    return this.summaries.forOwner(userId, id, query.currency);
  }
}
