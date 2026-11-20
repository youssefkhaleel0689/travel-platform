import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { forbidden, unauthenticated } from '../common/swagger/standard-errors';
import { CreateReportDto, ReportDto } from './dto/moderation.dto';
import { ModerationService } from './moderation.service';

const PATH = '/api/reports';

/** GEN-09: report a post, comment, review or itinerary, at most once each. */
@ApiTags('Moderation')
@ApiCookieAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @Post()
  @ApiOperation({
    summary: 'Report a post, comment, review or itinerary (GEN-09)',
    description:
      'Login required. One report per user per item. Only content everyone ' +
      'can see can be reported, and never your own. reason OTHER needs details.',
  })
  @ApiCreatedResponse({ type: ReportDto })
  @ApiErrorResponse({
    status: 400,
    description: 'An invalid field, or your own content',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: PATH,
        errors: [
          {
            field: 'details',
            messages: ['details is required when reason is OTHER'],
          },
        ],
      },
      {
        code: 'CANNOT_REPORT_OWN_CONTENT',
        message: 'You cannot report your own content',
        path: PATH,
      },
    ],
  })
  @ApiErrorResponse(unauthenticated(PATH))
  @ApiErrorResponse(forbidden(PATH, { role: false, passwordChange: true }))
  @ApiErrorResponse({
    status: 404,
    description: 'No such item, or it is not visible to you',
    examples: [
      { code: 'CONTENT_NOT_FOUND', message: 'Content not found', path: PATH },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'You already reported this item',
    examples: [
      {
        code: 'ALREADY_REPORTED',
        message: 'You have already reported this item',
        path: PATH,
      },
    ],
  })
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReportDto,
  ): Promise<ReportDto> {
    return this.moderation.report(user, dto);
  }
}
