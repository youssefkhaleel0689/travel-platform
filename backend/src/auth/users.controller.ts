import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { AuthenticatedGuard } from './guards/authenticated.guard';
import type { AuthenticatedUser } from './types/authenticated-user';
import { UsersService } from './users.service';

/**
 * The account's own profile. Every route here reads the id from the verified
 * cookie and never from the path or the body, so one account can only ever
 * read or change its own profile (ACC-11).
 */
@ApiTags('Accounts')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid access-token cookie, or the session expired',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description:
    'Account suspended or deactivated, or a password change is pending',
})
@UseGuards(AuthenticatedGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get your own profile (ACC-11)',
    description:
      'The profile behind the current cookie. Returns no credentials and no ' +
      'login-security fields.',
  })
  @ApiOkResponse({ type: UserProfileDto })
  async getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserProfileDto> {
    return UserProfileDto.fromDocument(await this.users.findByIdOrThrow(user.id));
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Edit your own name, phone and preferred currency (ACC-09)',
    description:
      'Only the three fields in the body can be changed; the email, role and ' +
      'status cannot. A field that is left out keeps its value, and null ' +
      'clears the phone or the preferred currency. The currency must be one ' +
      'of the seeded ones (GET /api/currencies).',
  })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'A field failed validation, or the currency is not seeded',
  })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    const updated = await this.users.updateProfile(user.id, dto);
    return UserProfileDto.fromDocument(updated);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate your own account (ACC-12)',
    description:
      'Needs confirm: true in the body. Blocked while the account still has ' +
      'an upcoming confirmed booking, because a deactivated account cannot ' +
      'sign in to manage or cancel one. Afterwards the account cannot sign ' +
      'in, its open sessions end at once, its posts and public itineraries ' +
      'are hidden and its comments and reviews read as "Deleted user". ' +
      'Nothing is deleted: past bookings, payments and refunds stay as they ' +
      'are, and only an administrator can undo the status.',
  })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'confirm was missing or not true',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'UPCOMING_BOOKINGS_EXIST, or the account is already deactivated',
  })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: DeactivateAccountDto,
  ): Promise<UserProfileDto> {
    const deactivated = await this.users.deactivateOwnAccount(user.id);
    return UserProfileDto.fromDocument(deactivated);
  }
}
