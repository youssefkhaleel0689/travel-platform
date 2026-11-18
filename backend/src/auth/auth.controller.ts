import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import {
  CurrentUser,
  OptionalUser,
} from '../common/auth/current-user.decorator';
import { AllowWhenPasswordChangeRequired } from '../common/auth/password-change.decorator';
import { Public } from '../common/auth/public.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users/users.service';

// Account endpoints: register (ACC-01), login (ACC-04), refresh and logout (ACC-06) and me
// (ACC-04, ACC-19); the rest come in later PRs.
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
      'cookie (30 minutes) and the httpOnly refresh_token cookie (path /api/auth, until the ' +
      'session ends); neither token is ever in the body.',
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
    // passthrough lets Nest still send the returned body while the service sets the cookies.
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.auth.register(dto, res));
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email and password (ACC-04, ACC-05)',
    description:
      'Public. On success the response sets the httpOnly access_token cookie (30 minutes) ' +
      'and the httpOnly refresh_token cookie (path /api/auth, until the session ends); ' +
      'neither token is ever in the body. A wrong password and an unknown email give the same ' +
      '401, and the account status is checked only after the password matches. After 5 ' +
      'consecutive wrong passwords the account is locked for 15 minutes (423), and a ' +
      'successful login resets the count.',
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
    description:
      'Wrong email or password (INVALID_CREDENTIALS). The 5th consecutive wrong password ' +
      'gets 423 instead, and so does any attempt while the account is locked.',
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
  @ApiErrorResponse({
    status: 423,
    description:
      'Too many failed attempts: the account is locked for 15 minutes',
    headers: {
      'Retry-After': {
        description:
          'Whole seconds until the lock ends (the same moment as details.lockedUntil)',
        schema: { type: 'integer', minimum: 1 },
      },
    },
    examples: [
      {
        code: 'ACCOUNT_LOCKED',
        message: 'account locked, try again later',
        path: '/api/auth/login',
        details: { lockedUntil: '2026-11-13T10:15:00.000Z' },
      },
    ],
  })
  async login(
    @Body() dto: LoginDto,
    // passthrough lets Nest still send the returned body while the service sets the cookies.
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.auth.login(dto, res));
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a new access token from the refresh token (ACC-06)',
    description:
      'Public, no body. Uses only the httpOnly refresh_token cookie (path /api/auth) and ' +
      'rotates it: the response sets a new access_token cookie and a new refresh_token ' +
      'cookie for the same session, and the old refresh token stops working at once. ' +
      'Neither token is ever in the body. Any failure (no or unknown cookie, a session that ' +
      'is revoked, idle for 30 minutes or past its end, an account that is not active) ' +
      'gives the same 401 and clears both cookies.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiErrorResponse({
    status: 401,
    description:
      'No valid refresh token, or the session is no longer valid (UNAUTHENTICATED)',
    examples: [
      {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        path: '/api/auth/refresh',
      },
    ],
  })
  async refresh(
    @Req() req: Request,
    // passthrough lets Nest still send the returned body while the service sets the cookies.
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.auth.refresh(req, res));
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Log out of the current session (ACC-06)',
    description:
      'Public, no body, always 204. Ends the current session found through the ' +
      'access_token cookie or the refresh_token cookie (either is enough), and always ' +
      'clears both cookies. Never fails for a missing or already ended session.',
  })
  @ApiNoContentResponse({
    description:
      'Logged out. Both auth cookies are cleared. Returned whether or not a session existed.',
  })
  async logout(
    // Set by JwtAuthGuard from a valid access cookie; undefined otherwise.
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    // passthrough lets Nest still send the 204 while the service clears the cookies.
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user, req, res);
  }

  @Get('me')
  // A user who must change the password still needs to learn who is logged in.
  @AllowWhenPasswordChangeRequired()
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
  @AllowWhenPasswordChangeRequired()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Change your own password (ACC-08)',
    description:
      'Requires the current password, so a stolen cookie on its own cannot ' +
      'take over the account. The new password goes through the same rules as ' +
      'registration and must differ from the current one. Clears the ' +
      'temporary-password state set by an admin reset (ACC-07a).\n\n' +
      'Every other session of the account is signed out (ACC-06); the ' +
      'device that made the change stays logged in.',
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
    await this.auth.changeOwnPassword(
      user,
      dto.currentPassword,
      dto.newPassword,
    );
    return new MessageResponseDto('Password changed');
  }
}
