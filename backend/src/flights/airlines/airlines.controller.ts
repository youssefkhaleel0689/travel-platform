import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  CurrentUser,
  OptionalUser,
} from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
import { AirlinesService } from './airlines.service';
import { AirlineIdParamDto } from './dto/airline-id-param.dto';
import { AirlineDto } from './dto/airline.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

// FLT-01: airline profiles. POST needs ADMIN, PATCH needs ADMIN or AIRLINE_MODERATOR (a
// moderator only for the airline they are assigned to, checked in the service), GET is
// public. The logged-in user comes from @CurrentUser() / @OptionalUser().
@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create an airline profile (FLT-01, admin only)',
    description:
      'The airline starts ACTIVE with no logo. The logo is uploaded with PUT /api/airlines/{id}/logo (GEN-08).',
  })
  @ApiBody({ type: CreateAirlineDto })
  @ApiCreatedResponse({ type: AirlineDto })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed (field-level errors)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/airlines',
        errors: [
          {
            field: 'iataCode',
            messages: ['iataCode must be 2 letters or digits (for example MS)'],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description:
      'Not logged in, or the session is no longer valid (UNAUTHENTICATED)',
    examples: [
      {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        path: '/api/airlines',
      },
    ],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Not an admin',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
        path: '/api/airlines',
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'iataCode or icaoCode already used (DUPLICATE_KEY)',
    examples: [
      {
        code: 'DUPLICATE_KEY',
        message: 'iataCode already exists',
        path: '/api/airlines',
        errors: [{ field: 'iataCode', messages: ['already exists'] }],
      },
    ],
  })
  create(
    @Body() dto: CreateAirlineDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AirlineDto> {
    return this.airlines.create(dto, user);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get one airline (FLT-01)',
    description:
      'Public for ACTIVE airlines. A DEACTIVATED airline is visible only to an admin ' +
      'or its assigned moderator; others get 404.',
  })
  @ApiOkResponse({ type: AirlineDto })
  @ApiErrorResponse({
    status: 400,
    description: 'Bad id',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/airlines/not-an-id',
        errors: [{ field: 'id', messages: ['id must be a mongodb id'] }],
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such airline (AIRLINE_NOT_FOUND)',
    examples: [
      {
        code: 'AIRLINE_NOT_FOUND',
        message: 'Airline not found',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
      },
    ],
  })
  findOne(
    @Param() params: AirlineIdParamDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
  ): Promise<AirlineDto> {
    // A guest has no user: the service then hides a DEACTIVATED airline.
    return this.airlines.findOne(params.id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: "Edit an airline's name and codes (FLT-01)",
    description:
      'Admin, or the airline moderator assigned to this airline. Send at least one field. ' +
      'status cannot be changed here; the logo has its own endpoint (PUT /api/airlines/{id}/logo).',
  })
  @ApiBody({ type: UpdateAirlineDto })
  @ApiOkResponse({ type: AirlineDto })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed, or no field sent (EMPTY_UPDATE)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
        errors: [
          {
            field: 'icaoCode',
            messages: ['icaoCode must be 3 letters (for example MSR)'],
          },
        ],
      },
      {
        code: 'EMPTY_UPDATE',
        message: 'Send at least one of name, iataCode, icaoCode',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
        errors: [
          {
            field: 'body',
            messages: ['send at least one of name, iataCode, icaoCode'],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description:
      'Not logged in, or the session is no longer valid (UNAUTHENTICATED)',
    examples: [
      {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
      },
    ],
  })
  @ApiErrorResponse({
    status: 403,
    description:
      'Not an admin or airline moderator (message: You do not have permission to do this), ' +
      'or a moderator of another airline (the example below)',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You can only edit the airline you are assigned to',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such airline (AIRLINE_NOT_FOUND)',
    examples: [
      {
        code: 'AIRLINE_NOT_FOUND',
        message: 'Airline not found',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'iataCode or icaoCode already used (DUPLICATE_KEY)',
    examples: [
      {
        code: 'DUPLICATE_KEY',
        message: 'iataCode already exists',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
        errors: [{ field: 'iataCode', messages: ['already exists'] }],
      },
    ],
  })
  update(
    @Param() params: AirlineIdParamDto,
    @Body() dto: UpdateAirlineDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AirlineDto> {
    return this.airlines.update(params.id, dto, user);
  }
}
