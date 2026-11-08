import { Body, Controller, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AllowPasswordChangePending } from './decorators/allow-password-change-pending.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { AuthenticatedGuard } from './guards/authenticated.guard';
import type { AuthenticatedUser } from './types/authenticated-user';
import { UsersService } from './users.service';

// Account-owned authentication actions. Registration, login, logout and
// /auth/me are part of the login work (ACC-01, ACC-04, ACC-06) and are added
// to this controller by their owner.
@ApiTags('Authentication')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid access-token cookie, or the session expired',
})
@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  @Patch('change-password')
  // An account on a temporary password is allowed here and nowhere else, which
  // is how it satisfies ACC-07a and ACC-13.
  @AllowPasswordChangePending()
  @UseGuards(AuthenticatedGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change your own password (ACC-08)',
    description:
      'Requires the current password. On success every other session of the ' +
      'account is revoked; the session that made the change stays signed in.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'The new password breaks the rules or equals the current one',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Account suspended or deactivated',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    await this.users.changeOwnPassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      user.sessionId,
    );
    return new MessageResponseDto('Password changed');
  }
}
