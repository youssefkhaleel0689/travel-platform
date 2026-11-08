import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAccountDto } from './dto/admin-account.dto';
import { AdminAccountsQueryDto } from './dto/admin-accounts-query.dto';
import { TemporaryPasswordDto } from './dto/temporary-password.dto';

/**
 * Admin-only account administration (ACC-07a, ACC-14, ACC-16).
 *
 * The guards are declared on the controller, so a route added later is
 * admin-only by default rather than open until someone remembers to lock it.
 * AuthenticatedGuard must come first: it is what puts the account on the
 * request for RolesGuard to check.
 *
 * Provider deactivation (PATCH /api/admin/providers/...) is a separate part of
 * ACC-15 and needs the airlines and hotels collections, so it is not here.
 */
@ApiTags('Administration')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid access-token cookie, or the session expired',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'Not an administrator, or the target is an administrator',
})
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminAccountsController {
  constructor(private readonly adminAccounts: AdminAccountsService) {}

  @Get('accounts')
  @ApiOperation({
    summary: 'List every account (ACC-14)',
    description:
      'Pages of 10, newest registration first (GEN-05). search matches a ' +
      'fragment of the name or the email, case-insensitively and literally; ' +
      'role and status narrow the list further.',
  })
  @ApiPaginatedResponse(AdminAccountDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Bad page, unknown role or status, or unknown query parameter',
  })
  listAccounts(
    @Query() query: AdminAccountsQueryDto,
  ): Promise<PageDto<AdminAccountDto>> {
    const { page, search, role, status } = query;
    return this.adminAccounts.listAccounts(page, { search, role, status });
  }

  @Patch('accounts/:id/suspend')
  @ApiOperation({
    summary: 'Suspend an account (ACC-16, ACC-15)',
    description:
      'The account can no longer sign in and its open sessions end at once, ' +
      'while its existing bookings stay valid. The owner gets an in-app ' +
      'notification (GEN-01). Suspending twice changes nothing.',
  })
  @ApiParam({ name: 'id', example: '6720f1c2a1b2c3d4e5f60718' })
  @ApiOkResponse({ type: AdminAccountDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Own account, or an account its owner deactivated',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'No such account' })
  suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AdminAccountDto> {
    return this.adminAccounts.suspend(admin.id, id);
  }

  @Patch('accounts/:id/reactivate')
  @ApiOperation({
    summary: 'Reactivate a suspended account (ACC-16, ACC-15)',
    description:
      'The account can sign in again, and any login lockout is cleared. An ' +
      'account its owner deactivated (ACC-12) cannot be reactivated here.',
  })
  @ApiParam({ name: 'id', example: '6720f1c2a1b2c3d4e5f60718' })
  @ApiOkResponse({ type: AdminAccountDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Own account, or an account its owner deactivated',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'No such account' })
  reactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AdminAccountDto> {
    return this.adminAccounts.reactivate(admin.id, id);
  }

  @Post('users/:id/reset-password')
  // POST, because issuing a new temporary password is not idempotent, but 200
  // rather than Nest's default 201: nothing new is created, an existing
  // account's password is replaced.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset an account's password to a temporary one (ACC-07a)",
    description:
      'Returns the temporary password once; it is stored only as a hash and ' +
      'is never shown again. Every session of the account ends, and until it ' +
      'sets its own password the only endpoint it can reach is PATCH ' +
      '/api/auth/change-password.',
  })
  @ApiParam({ name: 'id', example: '6720f1c2a1b2c3d4e5f60718' })
  @ApiOkResponse({ type: TemporaryPasswordDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Own account',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'No such account' })
  resetPassword(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TemporaryPasswordDto> {
    return this.adminAccounts.resetPassword(admin.id, id);
  }
}
