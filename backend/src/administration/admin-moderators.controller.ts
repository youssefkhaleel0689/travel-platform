import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../common/auth/auth.enums';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Roles } from '../common/auth/roles.decorator';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { forbidden, unauthenticated } from '../common/swagger/standard-errors';
import { AdminModeratorsService } from './admin-moderators.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ModeratorCreatedDto } from './dto/moderator-created.dto';

const PATH = '/api/admin/moderators';

/**
 * ACC-13: admin-only creation of provider moderator accounts.
 *
 * Separate from AdminAccountsController because this is the one admin route
 * that creates an account rather than acting on one that exists, and because
 * it is the only one that reaches into a provider module. The guards are on the
 * controller, so a route added later is admin-only by default.
 */
@ApiTags('Administration')
@ApiCookieAuth()
@ApiErrorResponse(unauthenticated(PATH))
@ApiErrorResponse(forbidden(PATH))
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminModeratorsController {
  constructor(private readonly moderators: AdminModeratorsService) {}

  @Post('moderators')
  @ApiOperation({
    summary: 'Create an airline or hotel moderator account (ACC-13)',
    description:
      'Creates the account and links it to exactly one airline or hotel, ' +
      'which must already exist and must not be deactivated. Name it with ' +
      'airlineId when role is AIRLINE_MODERATOR, or with hotelId when role ' +
      'is HOTEL_MODERATOR; sending the id that does not match the role is a ' +
      '400. The temporary ' +
      'password is returned once: either the one sent in the body or, if none ' +
      'was sent, a generated one. Until the moderator replaces it through ' +
      'PATCH /api/auth/change-password, every other endpoint answers 403 ' +
      'PASSWORD_CHANGE_REQUIRED (ACC-07a).',
  })
  // Two named examples rather than the schema's own sample body. Swagger UI
  // builds that sample from every property, which for this body means both
  // airlineId and hotelId at once - a body the endpoint refuses. These give
  // Try it out a request that is valid as it stands, and the example picker
  // doubles as the choice between an airline and a hotel moderator.
  @ApiBody({
    type: CreateModeratorDto,
    examples: {
      airline: {
        summary: 'Airline moderator',
        value: {
          name: 'Omar Fathy',
          email: 'omar@airline.example.com',
          role: Role.AIRLINE_MODERATOR,
          airlineId: '6720f1c2a1b2c3d4e5f60718',
          password: 'Welcome2026',
        },
      },
      hotel: {
        summary: 'Hotel moderator',
        value: {
          name: 'Omar Fathy',
          email: 'omar@hotel.example.com',
          role: Role.HOTEL_MODERATOR,
          hotelId: '6720f1c2a1b2c3d4e5f60718',
          password: 'Welcome2026',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: ModeratorCreatedDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'Invalid body, unknown field, a role other than the two moderator ' +
      'roles, a provider id that does not match the role, or a deactivated ' +
      'provider',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: PATH,
      },
      {
        code: 'PROVIDER_DEACTIVATED',
        message: 'This airline is deactivated and cannot be given a moderator',
        path: PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No airline has that airlineId, or no hotel has that hotelId',
    examples: [
      { code: 'AIRLINE_NOT_FOUND', message: 'Airline not found', path: PATH },
      { code: 'HOTEL_NOT_FOUND', message: 'Hotel not found', path: PATH },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'The email is already registered',
    examples: [
      {
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'email is already registered',
        path: PATH,
      },
    ],
  })
  create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CreateModeratorDto,
  ): Promise<ModeratorCreatedDto> {
    return this.moderators.create(admin.userId, dto);
  }
}
