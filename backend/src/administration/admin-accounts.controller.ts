import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { Role } from '../common/auth/auth.enums';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
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
@ApiErrorResponse(unauthenticated('/api/admin/accounts'))
@ApiErrorResponse(forbidden('/api/admin/accounts'))
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
  @ApiErrorResponse({
    status: 400,
    description: 'Bad page, unknown role or status, or unknown query parameter',
    examples: [
      { code: 'VALIDATION_FAILED', message: 'Bad page, unknown role or status, or unknown query parameter', path: '/api/admin/accounts' },
    ],
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
  @ApiErrorResponse({
    status: 400,
    description: 'Own account, or an account its owner deactivated',
    examples: [
      { code: 'VALIDATION_FAILED', message: 'Own account, or an account its owner deactivated', path: '/api/admin/accounts' },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such account',
    examples: [
      { code: 'NOT_FOUND', message: 'Account not found', path: '/api/admin/accounts' },
    ],
  })
  suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AdminAccountDto> {
    return this.adminAccounts.suspend(admin.userId, id);
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
  @ApiErrorResponse({
    status: 400,
    description: 'Own account, or an account its owner deactivated',
    examples: [
      { code: 'VALIDATION_FAILED', message: 'Own account, or an account its owner deactivated', path: '/api/admin/accounts' },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such account',
    examples: [
      { code: 'NOT_FOUND', message: 'Account not found', path: '/api/admin/accounts' },
    ],
  })
  reactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AdminAccountDto> {
    return this.adminAccounts.reactivate(admin.userId, id);
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
  @ApiErrorResponse({
    status: 400,
    description: 'Own account',
    examples: [
      { code: 'VALIDATION_FAILED', message: 'Own account', path: '/api/admin/accounts' },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such account',
    examples: [
      { code: 'NOT_FOUND', message: 'Account not found', path: '/api/admin/accounts' },
    ],
  })
  resetPassword(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TemporaryPasswordDto> {
    return this.adminAccounts.resetPassword(admin.userId, id);
  }
}
