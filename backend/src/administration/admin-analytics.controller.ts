import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../common/auth/auth.enums';
import { Roles } from '../common/auth/roles.decorator';
import { AdminAnalyticsService } from './admin-analytics.service';
import {
  AdminAnalyticsDto,
  AdminAnalyticsQueryDto,
} from './dto/admin-analytics.dto';

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
  get(@Query() query: AdminAnalyticsQueryDto): Promise<AdminAnalyticsDto> {
    return this.analytics.get(query);
  }
}
