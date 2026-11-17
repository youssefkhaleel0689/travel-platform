import { Controller, Get } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
import { AuthService } from '../auth.service';
import { UserResponseDto } from '../dto/user-response.dto';

// The caller's own account (ACC-11). C2 adds PATCH (ACC-09) and DELETE (ACC-12) on /users/me.
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'My profile (ACC-11)',
    description:
      "The caller's own profile. PATCH (ACC-09) and DELETE (ACC-12) on this path come later.",
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
        path: '/api/users/me',
      },
    ],
  })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.auth.currentProfile(user.userId));
  }
}
