import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AcceptPoliciesDto } from './dto/accept-policies.dto';
import { BookingParamsDto } from './dto/booking-params.dto';
import { BookingPoliciesDto } from './dto/booking-policies.dto';
import { PolicyAcceptanceDto } from './dto/policy-acceptance.dto';
import { PolicyAcceptancesService } from './policy-acceptances.service';

/**
 * PAY-02: the provider's terms must be shown and accepted before payment.
 *
 * Both routes are owner-only: the booking is read through BookingsPort and
 * checked against the account in the cookie, so another account's booking
 * answers 404 (ACC-11).
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
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'No such booking for this account',
})
@ApiBadRequestResponse({
  type: ErrorResponseDto,
  description: 'Bad booking type or id, or a body that fails validation',
})
@UseGuards(AuthenticatedGuard)
@Controller('bookings')
export class BookingPoliciesController {
  constructor(private readonly policies: PolicyAcceptancesService) {}

  @Get(':type/:id/policies')
  @ApiOperation({
    summary: "Show the provider's policies for a booking (PAY-02)",
    description:
      'The terms this booking carries, taken when it was created, so a later ' +
      'provider edit never changes them. An airline sends its baggage rules ' +
      'and cancellation tiers; a hotel sends its cancellation tiers and its ' +
      'check-in and check-out times. accepted says whether these exact terms ' +
      'have already been accepted.',
  })
  @ApiOkResponse({ type: BookingPoliciesDto })
  getPolicies(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BookingParamsDto,
  ): Promise<BookingPoliciesDto> {
    return this.policies.getPolicies(user.id, params.type, params.id);
  }

  @Post(':type/:id/accept-policies')
  // 200, not Nest's default 201: accepting the same version twice returns the
  // acceptance that already exists rather than creating another.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept the policies before paying (PAY-02)',
    description:
      'Stores the exact terms, their version and the moment of acceptance. ' +
      'Payment is refused until this exists. policyVersion must match the ' +
      'value from the policies endpoint, so acceptance can only be given for ' +
      'terms that were really shown. Accepting twice is harmless and keeps ' +
      'the first timestamp.',
  })
  @ApiOkResponse({ type: PolicyAcceptanceDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'POLICY_VERSION_MISMATCH, or the booking no longer awaits payment',
  })
  acceptPolicies(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BookingParamsDto,
    @Body() dto: AcceptPoliciesDto,
  ): Promise<PolicyAcceptanceDto> {
    return this.policies.accept(
      user.id,
      params.type,
      params.id,
      dto.policyVersion,
    );
  }
}
