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
import {
  CreateBudgetEntryDto,
  UpdateBudgetEntryDto,
} from './dto/budget-entry.dto';
import {
  CreateTransportCostDto,
  UpdateTransportCostDto,
} from './dto/transport-cost.dto';
import { BudgetsService } from './budgets.service';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  badRequestError,
  DAY_NOT_FOUND_EXAMPLE,
  EXAMPLE_BUDGET_ID,
  EXAMPLE_DAY_ID,
  EXAMPLE_TRANSPORT_ID,
  ITINERARY_NOT_FOUND_EXAMPLE,
  ITINERARY_PATH,
  notFoundError,
  UNKNOWN_CITY,
  UNSUPPORTED_CURRENCY,
} from './itinerary-api-docs';

class BudgetEntryResponseDto {
  @ApiProperty({ example: EXAMPLE_BUDGET_ID })
  id: string;
  @ApiProperty({ example: 'food' })
  category: string;
  @ApiProperty({
    example: '40.00',
    description: 'Decimal string with 2 decimals, in `currency`',
  })
  amount: string;
  @ApiProperty({ example: 'EUR' })
  currency: string;
}

class TransportCostResponseDto {
  @ApiProperty({ example: EXAMPLE_TRANSPORT_ID })
  id: string;
  @ApiProperty({ example: 'train' })
  mode: string;
  @ApiProperty({ example: 'london' })
  fromCity: string;
  @ApiProperty({ example: 'paris' })
  toCity: string;
  @ApiProperty({
    example: '120.00',
    description: 'Decimal string with 2 decimals, in `currency`',
  })
  amount: string;
  @ApiProperty({ example: 'GBP' })
  currency: string;
  @ApiProperty({ example: EXAMPLE_DAY_ID })
  dayId: string;
}

const CREATE_BUDGET_PATH = `${ITINERARY_PATH}/days/${EXAMPLE_DAY_ID}/budgets`;
const BUDGET_PATH = `/api/budgets/${EXAMPLE_BUDGET_ID}`;
const CREATE_TRANSPORT_PATH = `${ITINERARY_PATH}/transport-costs`;
const TRANSPORT_PATH = `/api/transport-costs/${EXAMPLE_TRANSPORT_ID}`;
const BUDGET_NOT_FOUND_EXAMPLE = {
  code: 'BUDGET_ENTRY_NOT_FOUND',
  message: 'Budget entry not found',
};
const TRANSPORT_NOT_FOUND_EXAMPLE = {
  code: 'TRANSPORT_COST_NOT_FOUND',
  message: 'Transport cost not found',
};
const SAME_CITY = {
  code: 'SAME_CITY',
  message: 'fromCity and toCity must be different',
};

@ApiTags('Itineraries - Budget')
@ApiItineraryAuth(BUDGET_PATH)
@Controller()
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  // ---------- budget entries (ITN-14) ----------

  @Post('itineraries/:id/days/:dayId/budgets')
  @ApiOperation({
    summary: 'Add a budget entry to a day (ITN-14)',
    description:
      'Categories: food, accommodation, local_transport, activities. Any seeded currency; the summary converts.',
  })
  @ApiCreatedResponse({ type: BudgetEntryResponseDto })
  @ApiErrorResponse(
    badRequestError(
      CREATE_BUDGET_PATH,
      [{ field: 'amount', messages: ['amount must not be less than 0'] }],
      UNSUPPORTED_CURRENCY,
    ),
  )
  @ApiErrorResponse(
    notFoundError(
      CREATE_BUDGET_PATH,
      ITINERARY_NOT_FOUND_EXAMPLE,
      DAY_NOT_FOUND_EXAMPLE,
    ),
  )
  createEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateBudgetEntryDto,
  ) {
    return this.budgets.createEntry(user, id, dayId, dto);
  }

  @Patch('budgets/:id')
  @ApiOperation({ summary: 'Edit a budget entry (ITN-14)' })
  @ApiOkResponse({ type: BudgetEntryResponseDto })
  @ApiErrorResponse(
    badRequestError(
      BUDGET_PATH,
      [
        {
          field: 'category',
          messages: [
            'category must be one of the following values: food, accommodation, local_transport, activities',
          ],
        },
      ],
      UNSUPPORTED_CURRENCY,
    ),
  )
  @ApiErrorResponse(notFoundError(BUDGET_PATH, BUDGET_NOT_FOUND_EXAMPLE))
  updateEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetEntryDto,
  ) {
    return this.budgets.updateEntry(user, id, dto);
  }

  @Delete('budgets/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a budget entry (ITN-14)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponse(notFoundError(BUDGET_PATH, BUDGET_NOT_FOUND_EXAMPLE))
  async removeEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.budgets.removeEntry(user, id);
  }

  // ---------- intercity transport costs (ITN-16) ----------

  @Post('itineraries/:id/transport-costs')
  @ApiOperation({
    summary: 'Add an intercity transport cost (ITN-16)',
    description:
      'Attached to one day of the itinerary; counted as intercity_transport, separate from local transport.',
  })
  @ApiCreatedResponse({ type: TransportCostResponseDto })
  @ApiErrorResponse(
    badRequestError(
      CREATE_TRANSPORT_PATH,
      [{ field: 'dayId', messages: ['dayId must be a mongodb id'] }],
      SAME_CITY,
      UNKNOWN_CITY,
      UNSUPPORTED_CURRENCY,
    ),
  )
  @ApiErrorResponse(
    notFoundError(
      CREATE_TRANSPORT_PATH,
      ITINERARY_NOT_FOUND_EXAMPLE,
      DAY_NOT_FOUND_EXAMPLE,
    ),
  )
  createTransport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateTransportCostDto,
  ) {
    return this.budgets.createTransport(user, id, dto);
  }

  @Patch('transport-costs/:id')
  @ApiOperation({ summary: 'Edit a transport cost (ITN-16)' })
  @ApiOkResponse({ type: TransportCostResponseDto })
  @ApiErrorResponse(
    badRequestError(
      TRANSPORT_PATH,
      [{ field: 'amount', messages: ['amount must not be less than 0'] }],
      SAME_CITY,
      UNKNOWN_CITY,
      UNSUPPORTED_CURRENCY,
    ),
  )
  @ApiErrorResponse(
    notFoundError(
      TRANSPORT_PATH,
      TRANSPORT_NOT_FOUND_EXAMPLE,
      DAY_NOT_FOUND_EXAMPLE,
    ),
  )
  updateTransport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTransportCostDto,
  ) {
    return this.budgets.updateTransport(user, id, dto);
  }

  @Delete('transport-costs/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a transport cost (ITN-16)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponse(notFoundError(TRANSPORT_PATH, TRANSPORT_NOT_FOUND_EXAMPLE))
  async removeTransport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.budgets.removeTransport(user, id);
  }
}
