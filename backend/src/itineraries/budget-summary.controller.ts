import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { BudgetSummaryQueryDto } from './dto/budget-summary-query.dto';
import { BudgetSummaryDto } from './dto/budget-summary-response.dto';
import { ItineraryBudgetSummaryService } from './itinerary-budget-summary.service';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  badRequestError,
  EXCHANGE_RATES_UNAVAILABLE,
  ITINERARY_NOT_FOUND_EXAMPLE,
  ITINERARY_PATH,
  notFoundError,
  UNSUPPORTED_CURRENCY,
} from './itinerary-api-docs';

const SUMMARY_PATH = `${ITINERARY_PATH}/budget-summary`;

@ApiTags('Itineraries - Budget')
@ApiItineraryAuth(SUMMARY_PATH)
@Controller('itineraries')
export class BudgetSummaryController {
  constructor(private readonly summaries: ItineraryBudgetSummaryService) {}

  @Get(':id/budget-summary')
  @ApiOperation({
    summary:
      'Budget totals by category, day and city, converted to one currency (ITN-14, ITN-18)',
    description:
      'Exchange rates come from FXRatesAPI through the backend only, cached once a day; when the API is down the last cached rates are used and ratesStale is true.',
  })
  @ApiOkResponse({ type: BudgetSummaryDto })
  @ApiErrorResponse(
    badRequestError(
      `${SUMMARY_PATH}?currency=EURO`,
      [
        {
          field: 'currency',
          messages: ['currency must be a 3-letter currency code'],
        },
      ],
      UNSUPPORTED_CURRENCY,
    ),
  )
  @ApiErrorResponse(notFoundError(SUMMARY_PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  @ApiErrorResponse(EXCHANGE_RATES_UNAVAILABLE)
  budgetSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: BudgetSummaryQueryDto,
  ) {
    return this.summaries.forOwner(user, id, query.currency);
  }
}
