import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../common/auth/auth.enums';
import { Roles } from '../common/auth/roles.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { AdminAnalyticsService } from './admin-analytics.service';
import {
  AdminAnalyticsDto,
  AdminAnalyticsQueryDto,
} from './dto/admin-analytics.dto';

const PATH = '/api/admin/analytics?from=2026-11-30&to=2026-11-01';

@ApiTags('Administration')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('analytics')
  @ApiOperation({
    summary: 'Bookings and revenue per provider over a period (BON-01)',
    description:
      'Admin only. Counts every booking created in the UTC date range and sums ' +
      'revenue from CONFIRMED and COMPLETED bookings, grouped by airline or hotel.',
  })
  @ApiOkResponse({ type: AdminAnalyticsDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'A date is not YYYY-MM-DD or not a real day (VALIDATION_FAILED), or from is after to (INVALID_DATE_RANGE)',
    examples: [
      {
        code: 'INVALID_DATE_RANGE',
        message: 'from must not be later than to',
        path: PATH,
        errors: [{ field: 'to', messages: ['to must be on or after from'] }],
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [
      {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        path: PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Not an admin (FORBIDDEN)',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
        path: PATH,
      },
    ],
  })
  get(@Query() query: AdminAnalyticsQueryDto): Promise<AdminAnalyticsDto> {
    return this.analytics.get(query);
  }
}
