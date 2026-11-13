import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import {
  ApiErrorResponse,
  type ApiErrorResponseOptions,
} from '../../common/swagger/api-error-response.decorator';
import { AuthService } from '../auth.service';
import { DeactivateAccountDto } from '../dto/deactivate-account.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { AccountsService } from './accounts.service';
import { UsersService } from './users.service';

const NOT_LOGGED_IN: ApiErrorResponseOptions = {
  status: 401,
  description:
    'Not logged in, or the session is no longer valid (UNAUTHENTICATED)',
  examples: [
    {
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
      path: '/api/users/me',
    },
  ],
};

/**
 * The caller's own account: read (ACC-11), edit (ACC-09) and deactivate
 * (ACC-12).
 *
 * No route takes an id. The account always comes from the verified cookie, so
 * there is nothing a caller could change to reach somebody else's profile.
 */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly accounts: AccountsService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  @Get('me')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'My profile (ACC-11)',
    description:
      "The caller's own profile. Returns no credential and no login-security " +
      'field.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiErrorResponse(NOT_LOGGED_IN)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.auth.currentProfile(user.userId));
  }

  @Patch('me')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit your name, phone and preferred currency (ACC-09)',
    description:
      'Only these three fields can be changed; the email, role and status ' +
      'cannot, and sending one is a 400 rather than a field that is silently ' +
      'ignored. A field that is left out keeps its value, and null clears the ' +
      'phone or the preferred currency. The currency must be one of the ' +
      'seeded ones (GET /api/currencies).',
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'A field failed validation, or the currency is not seeded ' +
      '(UNSUPPORTED_CURRENCY)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/users/me',
        errors: [
          {
            field: 'phone',
            messages: ['phone must be an optional + followed by 7 to 15 digits'],
          },
        ],
      },
      {
        code: 'UNSUPPORTED_CURRENCY',
        message: 'Unsupported currency: XYZ',
        path: '/api/users/me',
      },
    ],
  })
  @ApiErrorResponse(NOT_LOGGED_IN)
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    // GEN-12: a well-formed code still has to be one of the seeded currencies.
    if (dto.preferredCurrency) {
      await this.referenceData.assertSupportedCurrency(dto.preferredCurrency);
    }
    return UserResponseDto.from(
      await this.users.updateProfile(user.userId, dto),
    );
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Deactivate your own account (ACC-12)',
    description:
      'Needs confirm: true in the body: the requirement says "after ' +
      'confirmation", and the backend does not read an empty DELETE as ' +
      'consent just because a frontend showed a dialog (GEN-13).\n\n' +
      'Blocked while the account still has an upcoming confirmed booking, ' +
      'because a deactivated account cannot log in to manage or cancel one.\n\n' +
      'Nothing is deleted. The account keeps its row with a deactivation ' +
      'date, so past bookings, payments and refunds still point at a real ' +
      'account; only the status changes, and the blog and itinerary modules ' +
      'derive "hidden" and "Deleted user" from it. The account cannot log in ' +
      'again, and an administrator cannot undo it.',
  })
  @ApiBody({ type: DeactivateAccountDto })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiErrorResponse({
    status: 400,
    description: 'confirm was missing or not true',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/users/me',
        errors: [
          {
            field: 'confirm',
            messages: ['confirm must be true to deactivate the account'],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse(NOT_LOGGED_IN)
  @ApiErrorResponse({
    status: 409,
    description:
      'An upcoming confirmed booking exists (UPCOMING_BOOKINGS_EXIST), or the ' +
      'account is already deactivated (ALREADY_DEACTIVATED)',
    examples: [
      {
        code: 'UPCOMING_BOOKINGS_EXIST',
        message:
          'You still have upcoming confirmed bookings. Cancel them or wait ' +
          'until they are completed before deactivating your account.',
        path: '/api/users/me',
      },
    ],
  })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: DeactivateAccountDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(
      await this.accounts.deactivateOwnAccount(user.userId),
    );
  }
}
