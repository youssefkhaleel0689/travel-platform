import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
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
      'acceptTerms must be true. The password is stored only as a bcrypt hash (GEN-13).',
  })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Validation failed (field-level errors), including unknown fields such as role',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Email already registered (EMAIL_ALREADY_REGISTERED)',
  })
  async register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.auth.register(dto));
  }
}
