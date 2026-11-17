import { Body, Controller, Param, Put } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
import { AirlineIdParamDto } from '../airlines/dto/airline-id-param.dto';
import { AirlinePoliciesService } from './airline-policies.service';
import { AirlinePolicyDto } from './dto/airline-policy.dto';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CancellationPolicyDto } from './dto/cancellation-policy.dto';

const AIRLINE_ID_EXAMPLE = '6720f1c2a1b2c3d4e5f60718';
const BAGGAGE_PATH = `/api/airlines/${AIRLINE_ID_EXAMPLE}/baggage-policy`;
const CANCELLATION_PATH = `/api/airlines/${AIRLINE_ID_EXAMPLE}/cancellation-policy`;

const UNAUTHENTICATED = {
  code: 'UNAUTHENTICATED',
  message: 'Authentication required',
};
const NOT_MODERATOR = {
  code: 'FORBIDDEN',
  message: 'You do not have permission to do this',
};
const OTHER_AIRLINE = {
  code: 'NOT_ASSIGNED_TO_AIRLINE',
  message: 'You can only change the policy of the airline you are assigned to',
};
const AIRLINE_DEACTIVATED = {
  code: 'AIRLINE_DEACTIVATED',
  message: 'Your airline is deactivated and cannot change its policy',
};
const AIRLINE_NOT_FOUND = {
  code: 'AIRLINE_NOT_FOUND',
  message: 'Airline not found',
};

// FLT-08 and FLT-09: the policy of an airline. The airline in the path must be the one the
// logged-in moderator is assigned to (airlineModeratorAssignment, ACC-11).
@ApiTags('Airline policies')
@Controller('airlines/:id')
export class AirlinePoliciesController {
  constructor(private readonly policies: AirlinePoliciesService) {}

  @Put('baggage-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Set the extra-bag policy of your airline (FLT-08, airline moderator)',
    description:
      'Sets the price of one extra bag (> 0) and the maximum extra bags per passenger (>= 0). ' +
      'Each extra bag has the same maximum weight as the free-baggage allowance of the booked cabin (maxBagWeightKg, FLT-04), so no weight is stored here. Replaces the baggage part of the policy; the cancellation tiers are kept. Returns the whole policy.',
  })
  @ApiBody({ type: BaggagePolicyDto })
  @ApiOkResponse({ type: AirlinePolicyDto })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed (field-level errors)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: BAGGAGE_PATH,
        errors: [
          {
            field: 'extraBagPrice',
            messages: ['extraBagPrice must be greater than 0'],
          },
          {
            field: 'maxExtraBagsPerPassenger',
            messages: ['maxExtraBagsPerPassenger must not be negative'],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in, or the session is no longer valid',
    examples: [{ ...UNAUTHENTICATED, path: BAGGAGE_PATH }],
  })
  @ApiErrorResponse({
    status: 403,
    description:
      'Not an airline moderator (FORBIDDEN), another airline (NOT_ASSIGNED_TO_AIRLINE), or your airline is deactivated (AIRLINE_DEACTIVATED)',
    examples: [
      { ...NOT_MODERATOR, path: BAGGAGE_PATH },
      { ...OTHER_AIRLINE, path: BAGGAGE_PATH },
      { ...AIRLINE_DEACTIVATED, path: BAGGAGE_PATH },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such airline (AIRLINE_NOT_FOUND)',
    examples: [{ ...AIRLINE_NOT_FOUND, path: BAGGAGE_PATH }],
  })
  setBaggagePolicy(
    @Param() params: AirlineIdParamDto,
    @Body() dto: BaggagePolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AirlinePolicyDto> {
    return this.policies.setBaggagePolicy(params.id, dto, user);
  }

  @Put('cancellation-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Set the cancellation tiers of your airline (FLT-09, airline moderator)',
    description:
      'Replaces the whole list of tiers. Each tier has a unique days-before-departure threshold (whole number >= 0) and a refund percentage (0-100). ' +
      'A cancellation uses the tier with the highest threshold not exceeding the days remaining; if no tier applies the refund is 0%. An empty list means every refund is 0%. The baggage part is kept. Returns the whole policy.',
  })
  @ApiBody({ type: CancellationPolicyDto })
  @ApiOkResponse({ type: AirlinePolicyDto })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed (field-level errors)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: CANCELLATION_PATH,
        errors: [
          {
            field: 'cancellationTiers',
            messages: [
              'each daysBeforeDeparture threshold may be used only once',
            ],
          },
          {
            field: 'cancellationTiers.1.refundPercentage',
            messages: ['refundPercentage must not be above 100'],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in, or the session is no longer valid',
    examples: [{ ...UNAUTHENTICATED, path: CANCELLATION_PATH }],
  })
  @ApiErrorResponse({
    status: 403,
    description:
      'Not an airline moderator (FORBIDDEN), another airline (NOT_ASSIGNED_TO_AIRLINE), or your airline is deactivated (AIRLINE_DEACTIVATED)',
    examples: [
      { ...NOT_MODERATOR, path: CANCELLATION_PATH },
      { ...OTHER_AIRLINE, path: CANCELLATION_PATH },
      { ...AIRLINE_DEACTIVATED, path: CANCELLATION_PATH },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such airline (AIRLINE_NOT_FOUND)',
    examples: [{ ...AIRLINE_NOT_FOUND, path: CANCELLATION_PATH }],
  })
  setCancellationPolicy(
    @Param() params: AirlineIdParamDto,
    @Body() dto: CancellationPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AirlinePolicyDto> {
    return this.policies.setCancellationPolicy(params.id, dto, user);
  }
}
