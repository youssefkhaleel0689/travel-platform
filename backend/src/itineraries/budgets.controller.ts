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
import {
  CreateBudgetEntryDto,
  UpdateBudgetEntryDto,
} from './dto/budget-entry.dto';
import {
  CreateTransportCostDto,
  UpdateTransportCostDto,
} from './dto/transport-cost.dto';
import { BudgetsService } from './budgets.service';

class BudgetEntryResponseDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60730' })
  id: string;
  @ApiProperty({ example: 'food' })
  category: string;
  @ApiProperty({ example: 40 })
  amount: number;
  @ApiProperty({ example: 'EUR' })
  currency: string;
}

class TransportCostResponseDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60740' })
  id: string;
  @ApiProperty({ example: 'train' })
  mode: string;
  @ApiProperty({ example: 'london' })
  fromCity: string;
  @ApiProperty({ example: 'paris' })
  toCity: string;
  @ApiProperty({ example: 120 })
  amount: number;
  @ApiProperty({ example: 'GBP' })
  currency: string;
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60719' })
  dayId: string;
}

@ApiTags('Itineraries - Budget')
// TEMPORARY: remove this header once the Auth module is merged.
@ApiHeader({
  name: 'x-dev-user-id',
  description: 'TEMPORARY dev user id (a 24-hex ObjectId) until auth is merged',
  required: false,
})
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@Controller()
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  // ---------- budget entries (ITN-14) ----------

  @Post('itineraries/:id/days/:dayId/budgets')
  @ApiOperation({ summary: 'Add a budget entry to a day (ITN-14)' })
  @ApiCreatedResponse({ type: BudgetEntryResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  createEntry(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateBudgetEntryDto,
  ) {
    return this.budgets.createEntry(userId, id, dayId, dto);
  }

  @Patch('budgets/:id')
  @ApiOperation({ summary: 'Edit a budget entry (ITN-14)' })
  @ApiOkResponse({ type: BudgetEntryResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  updateEntry(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetEntryDto,
  ) {
    return this.budgets.updateEntry(userId, id, dto);
  }

  @Delete('budgets/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a budget entry (ITN-14)' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async removeEntry(@CurrentUserId() userId: string, @Param('id') id: string) {
    await this.budgets.removeEntry(userId, id);
  }

  // ---------- intercity transport costs (ITN-16) ----------

  @Post('itineraries/:id/transport-costs')
  @ApiOperation({ summary: 'Add an intercity transport cost (ITN-16)' })
  @ApiCreatedResponse({ type: TransportCostResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  createTransport(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: CreateTransportCostDto,
  ) {
    return this.budgets.createTransport(userId, id, dto);
  }

  @Patch('transport-costs/:id')
  @ApiOperation({ summary: 'Edit a transport cost (ITN-16)' })
  @ApiOkResponse({ type: TransportCostResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  updateTransport(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTransportCostDto,
  ) {
    return this.budgets.updateTransport(userId, id, dto);
  }

  @Delete('transport-costs/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a transport cost (ITN-16)' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async removeTransport(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    await this.budgets.removeTransport(userId, id);
  }
}
