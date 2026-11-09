import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
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
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid access-token cookie, or the session expired',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description:
    'Account suspended or deactivated, or a password change is pending',
})
@UseGuards(AuthenticatedGuard)
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
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such refund for this account',
  })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RefundDto> {
    return RefundDto.fromDocument(
      await this.refunds.findOwnOrThrow(user.id, id),
    );
  }
}
