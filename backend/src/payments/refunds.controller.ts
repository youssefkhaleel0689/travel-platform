import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
} from '../common/swagger/standard-errors';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { RefundDto } from './dto/refund.dto';
import { RefundsService } from './refunds.service';

/**
 * PAY-03: reading a refund's status.
 *
 * There is no endpoint to create one: a refund only ever follows a
 * cancellation, so the flights and hotels modules raise it through
 * RefundsService when they cancel a booking. Letting a client ask for a refund
 * directly would be a way to get money back without cancelling anything.
 */
@ApiTags('Payments and policies')
@ApiCookieAuth()
@ApiErrorResponse(unauthenticated('/api/refunds/6720f1c2a1b2c3d4e5f60920'))
@ApiErrorResponse(forbidden('/api/refunds/6720f1c2a1b2c3d4e5f60920'))
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Refund status (PAY-03)',
    description:
      'A refund of your own booking: the amount, the tier that was applied, ' +
      'the terms it came from and whether it is PENDING, REFUNDED or FAILED. ' +
      "Another account's refund answers 404, like one that does not exist.",
  })
  @ApiParam({ name: 'id', example: '6720f1c2a1b2c3d4e5f60920' })
  @ApiOkResponse({ type: RefundDto })
  @ApiErrorResponse({
    status: 404,
    description: 'No such refund for this account',
    examples: [
      { code: 'NOT_FOUND', message: 'Refund not found', path: '/api/refunds/6720f1c2a1b2c3d4e5f60920' },
    ],
  })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RefundDto> {
    return RefundDto.fromDocument(
      await this.refunds.findOwnOrThrow(user.userId, id),
    );
  }
}
