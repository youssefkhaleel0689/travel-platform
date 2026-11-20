import { Controller, Param, Patch } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { Role } from '../common/auth/auth.enums';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
  validationFailed,
} from '../common/swagger/standard-errors';
import { AdminProvidersService } from './admin-providers.service';
import {
  AdminProviderParamsDto,
  AdminProviderStatusDto,
  ProviderType,
} from './dto/admin-provider.dto';

const EXAMPLE_ID = '6720f1c2a1b2c3d4e5f60788';
const DEACTIVATE_PATH = `/api/admin/providers/hotel/${EXAMPLE_ID}/deactivate`;
const REACTIVATE_PATH = `/api/admin/providers/hotel/${EXAMPLE_ID}/reactivate`;

const typeParam = ApiParam({
  name: 'type',
  enum: ProviderType,
  example: ProviderType.HOTEL,
  description: 'Which kind of provider the id names',
});
const idParam = ApiParam({
  name: 'id',
  example: EXAMPLE_ID,
  description: 'The hotel or airline id',
});

// 404: a missing provider and a malformed id answer the same (ACC-11).
function providerNotFound(path: string) {
  return ApiErrorResponse({
    status: 404,
    description: 'No hotel or airline with this id, or a malformed id',
    examples: [
      { code: 'HOTEL_NOT_FOUND', message: 'Hotel not found', path },
      {
        code: 'AIRLINE_NOT_FOUND',
        message: 'Airline not found',
        path: path.replace('/hotel/', '/airline/'),
      },
    ],
  });
}

/**
 * The provider half of ACC-15: an admin deactivates or reactivates a hotel or an
 * airline. (The moderator-account half is PATCH /api/admin/accounts/:id/suspend and
 * /reactivate, in AdminAccountsController.)
 *
 * Admin-only on the controller, like AdminAccountsController, so a route added later is
 * locked by default.
 */
@ApiTags('Administration')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin/providers')
export class AdminProvidersController {
  constructor(private readonly providers: AdminProvidersService) {}

  @Patch(':type/:id/deactivate')
  @ApiOperation({
    summary: 'Deactivate a hotel or an airline (ACC-15)',
    description:
      'Its listings are hidden from search and cannot be booked; existing ' +
      'CONFIRMED bookings stay valid and are not changed. The change is written ' +
      'to the audit log (GEN-07), and its moderators and the users with an ' +
      'upcoming confirmed booking get an in-app notification (GEN-01).',
  })
  @typeParam
  @idParam
  @ApiOkResponse({ type: AdminProviderStatusDto })
  @ApiErrorResponse(
    validationFailed(
      DEACTIVATE_PATH.replace('/hotel/', '/train/'),
      [{ field: 'type', messages: ['type must be hotel or airline'] }],
      'type is not hotel or airline',
    ),
  )
  @ApiErrorResponse(unauthenticated(DEACTIVATE_PATH))
  @ApiErrorResponse(forbidden(DEACTIVATE_PATH))
  @providerNotFound(DEACTIVATE_PATH)
  @ApiErrorResponse({
    status: 409,
    description: 'The provider is already deactivated',
    examples: [
      {
        code: 'HOTEL_ALREADY_DEACTIVATED',
        message: 'Hotel is already deactivated',
        path: DEACTIVATE_PATH,
      },
      {
        code: 'AIRLINE_ALREADY_DEACTIVATED',
        message: 'Airline is already deactivated',
        path: DEACTIVATE_PATH.replace('/hotel/', '/airline/'),
      },
    ],
  })
  deactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param() params: AdminProviderParamsDto,
  ): Promise<AdminProviderStatusDto> {
    return this.providers.deactivate(admin.userId, params.type, params.id);
  }

  @Patch(':type/:id/reactivate')
  @ApiOperation({
    summary: 'Reactivate a hotel or an airline (ACC-15)',
    description:
      'Its listings can be searched and booked again. The change is written to ' +
      'the audit log (GEN-07), and its moderators and the users with an upcoming ' +
      'confirmed booking get an in-app notification (GEN-01).',
  })
  @typeParam
  @idParam
  @ApiOkResponse({ type: AdminProviderStatusDto })
  @ApiErrorResponse(
    validationFailed(
      REACTIVATE_PATH.replace('/hotel/', '/train/'),
      [{ field: 'type', messages: ['type must be hotel or airline'] }],
      'type is not hotel or airline',
    ),
  )
  @ApiErrorResponse(unauthenticated(REACTIVATE_PATH))
  @ApiErrorResponse(forbidden(REACTIVATE_PATH))
  @providerNotFound(REACTIVATE_PATH)
  @ApiErrorResponse({
    status: 409,
    description: 'The provider is already active',
    examples: [
      {
        code: 'HOTEL_ALREADY_ACTIVE',
        message: 'Hotel is already active',
        path: REACTIVATE_PATH,
      },
      {
        code: 'AIRLINE_ALREADY_ACTIVE',
        message: 'Airline is already active',
        path: REACTIVATE_PATH.replace('/hotel/', '/airline/'),
      },
    ],
  })
  reactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param() params: AdminProviderParamsDto,
  ): Promise<AdminProviderStatusDto> {
    return this.providers.reactivate(admin.userId, params.type, params.id);
  }
}
