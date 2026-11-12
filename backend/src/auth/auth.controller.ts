import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';

// Account endpoints. ACC-01 (register) for now; login and the rest come in later PRs.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
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
}
