import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AllowPasswordChangePending } from '../common/auth/password-change-pending.decorator';
import { Public } from '../common/auth/public.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users/users.service';

// Account endpoints: register (ACC-01), login (ACC-04) and me (ACC-04, ACC-19); the rest
// come in later PRs.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a traveller account (ACC-01)',
    description:
      'Public. Creates an ACTIVE account with the USER role; the role cannot be chosen. ' +
      'acceptTerms must be true. The password is stored only as a bcrypt hash (GEN-13). ' +
      'On success the user is logged in: the response sets the httpOnly access_token ' +
      'cookie (30 minutes); the token is never in the body.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'Validation failed (field-level errors), including unknown fields such as role',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/auth/register',
        errors: [{ field: 'email', messages: ['email must be an email'] }],
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'Email already registered (EMAIL_ALREADY_REGISTERED)',
    examples: [
      {
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'email is already registered',
        path: '/api/auth/register',
        errors: [{ field: 'email', messages: ['email is already registered'] }],
      },
    ],
  })
  async register(
    @Body() dto: RegisterDto,
    // passthrough lets Nest still send the returned body while the service sets the cookie.
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.auth.register(dto, res));
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email and password (ACC-04)',
    description:
      'Public. On success the response sets the httpOnly access_token cookie (30 minutes); ' +
      'the token is never in the body. A wrong password and an unknown email give the same ' +
      '401, and the account status is checked only after the password matches.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'Validation failed (field-level errors), including unknown fields',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/auth/login',
        errors: [
          { field: 'password', messages: ['password should not be empty'] },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Wrong email or password (INVALID_CREDENTIALS)',
    examples: [
      {
        code: 'INVALID_CREDENTIALS',
        message: 'invalid email or password',
        path: '/api/auth/login',
      },
    ],
  })
  @ApiErrorResponse({
    status: 403,
    description:
      'Right password, but the account is suspended or deactivated (ACCOUNT_SUSPENDED, ACCOUNT_DEACTIVATED)',
    examples: [
      {
        code: 'ACCOUNT_SUSPENDED',
        message: 'account suspended',
        path: '/api/auth/login',
      },
      {
        code: 'ACCOUNT_DEACTIVATED',
        message: 'account deactivated',
        path: '/api/auth/login',
      },
    ],
  })
  async login(
    @Body() dto: LoginDto,
    // passthrough lets Nest still send the returned body while the service sets the cookie.
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.auth.login(dto, res));
  }

  @Get('me')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Who is logged in (ACC-04, ACC-19)',
    description:
      'The frontend calls this to learn who is logged in: the token is in an httpOnly ' +
      'cookie that page scripts cannot read. Returns the profile of the logged-in user.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiErrorResponse({
    status: 401,
    description:
      'Not logged in, or the session is no longer valid (UNAUTHENTICATED)',
    examples: [
      {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        path: '/api/auth/me',
      },
    ],
  })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.auth.currentProfile(user.userId));
  }

  @Patch('change-password')
  // The one authenticated route an account on a temporary password may reach
  // (ACC-07a), which is how it gets out of that state.
  @AllowPasswordChangePending()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Change your own password (ACC-08)',
    description:
      'Requires the current password, so a stolen cookie on its own cannot ' +
      'take over the account. The new password goes through the same rules as ' +
      'registration and must differ from the current one. Clears the ' +
      'temporary-password state set by an admin reset (ACC-07a).\n\n' +
      'Note: revoking the tokens already issued to the account’s other ' +
      'devices needs sessions, which arrive with ACC-06.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'The new password breaks the rules, or equals the current one (PASSWORD_UNCHANGED)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/auth/change-password',
        errors: [
          {
            field: 'newPassword',
            messages: ['password must be at least 8 characters'],
          },
        ],
      },
      {
        code: 'PASSWORD_UNCHANGED',
        message: 'The new password must be different from the current one',
        path: '/api/auth/change-password',
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description:
      'Not logged in (UNAUTHENTICATED), or the current password is wrong ' +
      '(INVALID_CURRENT_PASSWORD)',
    examples: [
      {
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Current password is incorrect',
        path: '/api/auth/change-password',
      },
    ],
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    await this.users.changeOwnPassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
    return new MessageResponseDto('Password changed');
  }
}
