import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
} from '../common/swagger/standard-errors';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
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
@ApiErrorResponse(unauthenticated('/api/bookings/hotel/6720f1c2a1b2c3d4e5f60718/policies'))
@ApiErrorResponse(forbidden('/api/bookings/hotel/6720f1c2a1b2c3d4e5f60718/policies'))
@ApiErrorResponse({
    status: 404,
    description: 'No such booking for this account',
    examples: [
      { code: 'NOT_FOUND', message: 'Booking not found', path: '/api/bookings/hotel/6720f1c2a1b2c3d4e5f60718/policies' },
    ],
  })
@ApiErrorResponse({
    status: 400,
    description: 'Bad booking type or id, or a body that fails validation',
    examples: [
      { code: 'VALIDATION_FAILED', message: 'Bad booking type or id, or a body that fails validation', path: '/api/bookings/hotel/6720f1c2a1b2c3d4e5f60718/policies' },
    ],
  })
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
    return this.policies.getPolicies(user.userId, params.type, params.id);
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
  @ApiErrorResponse({
    status: 409,
    description:
      'The terms moved on, or the booking no longer awaits payment. Both ' +
      'mean the acceptance was not stored.',
    examples: [
      {
        code: 'POLICY_VERSION_MISMATCH',
        message:
          'The policies have changed since they were shown. Read them again ' +
          'and accept the current version.',
        path: '/api/bookings/hotel/6720f1c2a1b2c3d4e5f60718/accept-policies',
      },
      {
        code: 'BOOKING_NOT_AWAITING_PAYMENT',
        message: 'This booking is EXPIRED and no longer awaits payment',
        path: '/api/bookings/hotel/6720f1c2a1b2c3d4e5f60718/accept-policies',
      },
    ],
  })
  acceptPolicies(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BookingParamsDto,
    @Body() dto: AcceptPoliciesDto,
  ): Promise<PolicyAcceptanceDto> {
    return this.policies.accept(
      user.userId,
      params.type,
      params.id,
      dto.policyVersion,
    );
  }
}
