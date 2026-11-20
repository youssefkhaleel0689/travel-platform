import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../common/auth/auth.enums';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { ModerationState } from '../common/moderation/moderation-state';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import {
  ApiErrorResponse,
  type ApiErrorResponseOptions,
} from '../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
  validationFailed,
} from '../common/swagger/standard-errors';
import {
  AdminReportsQueryDto,
  ContentParamsDto,
  ModerationOutcomeDto,
  ReportDto,
  ResolveReportDto,
} from './dto/moderation.dto';
import { ModerationService } from './moderation.service';

const REPORT_ID = '6720f1c2a1b2c3d4e5f60740';
const REPORTS = '/api/admin/reports';
const REPORT = `${REPORTS}/${REPORT_ID}`;
const CONTENT = '/api/admin/content/post/6720f1c2a1b2c3d4e5f60718';

function contentErrors(path: string): ApiErrorResponseOptions[] {
  return [
    validationFailed(path, [
      { field: 'type', messages: ['type must be one of the following values: POST, COMMENT, REVIEW, ITINERARY'] },
    ]),
    {
      status: 404,
      description: 'No such item',
      examples: [{ code: 'CONTENT_NOT_FOUND', message: 'Content not found', path }],
    },
    {
      status: 409,
      description:
        'Not allowed from the current state (a deleted item cannot be ' +
        'hidden or restored), or another admin changed it at the same moment',
      examples: [
        {
          code: 'INVALID_MODERATION_CHANGE',
          message: 'Content that is DELETED cannot be made VISIBLE',
          path,
        },
        {
          code: 'MODERATION_CONFLICT',
          message: 'The content changed at the same time; try again',
          path,
        },
      ],
    },
  ];
}

function ApiContentErrors(path: string) {
  return applyDecorators(
    ...contentErrors(path).map((options) => ApiErrorResponse(options)),
  );
}

/**
 * GEN-10 (and GEN-09 for the admin queue). Admin only, declared on the class
 * so a route added later cannot be left open by mistake. Every decision is
 * written to the audit log (GEN-07).
 */
@ApiTags('Moderation')
@ApiCookieAuth()
@ApiErrorResponse(unauthenticated(REPORTS))
@ApiErrorResponse(forbidden(REPORTS))
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('reports')
  @ApiOperation({
    summary: 'List reports, open ones by default (GEN-09, GEN-10)',
    description:
      'Open reports oldest first (a queue); resolved ones newest first. ' +
      'Each row shows the reported item, its current state and a preview.',
  })
  @ApiPaginatedResponse(ReportDto)
  @ApiErrorResponse(
    validationFailed(REPORTS, [
      { field: 'status', messages: ['status must be one of the following values: OPEN, DISMISSED, HIDDEN, DELETED'] },
    ]),
  )
  listReports(@Query() query: AdminReportsQueryDto): Promise<PageDto<ReportDto>> {
    return this.moderation.listReports(query);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary: 'Resolve a report: dismiss, hide or delete (GEN-10)',
    description:
      'HIDE and DELETE act on the reported item and close every open report ' +
      'on it. Hidden content stays visible to its author and admins only.',
  })
  @ApiParam({ name: 'id', description: 'Report id', example: REPORT_ID })
  @ApiOkResponse({ type: ReportDto })
  @ApiErrorResponse(
    validationFailed(REPORT, [
      { field: 'decision', messages: ['decision must be one of the following values: DISMISS, HIDE, DELETE'] },
    ]),
  )
  @ApiErrorResponse({
    status: 404,
    description: 'No such report',
    examples: [{ code: 'REPORT_NOT_FOUND', message: 'Report not found', path: REPORT }],
  })
  @ApiErrorResponse({
    status: 409,
    description:
      'Already resolved, the reported item no longer exists, or the item ' +
      'cannot take that state',
    examples: [
      { code: 'REPORT_ALREADY_RESOLVED', message: 'This report has already been resolved', path: REPORT },
      {
        code: 'CONTENT_GONE',
        message: 'The reported content no longer exists; dismiss the report instead',
        path: REPORT,
      },
      {
        code: 'INVALID_MODERATION_CHANGE',
        message: 'Content that is DELETED cannot be made HIDDEN',
        path: REPORT,
      },
    ],
  })
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ReportDto> {
    return this.moderation.resolve(id, dto.decision, admin);
  }

  @Patch('content/:type/:id/hide')
  @ApiOperation({
    summary: 'Hide any post, comment, review or itinerary (GEN-10)',
    description:
      'Only its author and admins can still see it. Closes its open reports.',
  })
  @ApiOkResponse({ type: ModerationOutcomeDto })
  @ApiContentErrors(`${CONTENT}/hide`)
  hide(
    @Param() params: ContentParamsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ModerationOutcomeDto> {
    return this.moderation.act(params.type, params.id, ModerationState.HIDDEN, admin);
  }

  @Patch('content/:type/:id/restore')
  @ApiOperation({
    summary: 'Make hidden content visible again (GEN-10)',
    description: 'Deleted content cannot be restored.',
  })
  @ApiOkResponse({ type: ModerationOutcomeDto })
  @ApiContentErrors(`${CONTENT}/restore`)
  restore(
    @Param() params: ContentParamsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ModerationOutcomeDto> {
    return this.moderation.act(params.type, params.id, ModerationState.VISIBLE, admin);
  }

  @Delete('content/:type/:id')
  @ApiOperation({
    summary: 'Delete any post, comment, review or itinerary (GEN-10)',
    description:
      'A soft delete: nobody but admins can see it any more, and the row ' +
      'stays for the audit trail. Closes its open reports.',
  })
  @ApiOkResponse({ type: ModerationOutcomeDto })
  @ApiContentErrors(CONTENT)
  remove(
    @Param() params: ContentParamsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ModerationOutcomeDto> {
    return this.moderation.act(params.type, params.id, ModerationState.DELETED, admin);
  }
}
