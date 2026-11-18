import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../common/auth/auth.enums';
import { Roles } from '../common/auth/roles.decorator';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
  validationFailed,
} from '../common/swagger/standard-errors';
import { AuditService } from './audit.service';
import { AuditLogDto } from './dto/audit-log.dto';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';

const PATH = '/api/admin/audit-logs';

/**
 * GEN-07: admins read the audit log. There is deliberately no route that
 * creates, edits or deletes a row: rows come only from the actions themselves.
 */
@ApiTags('Administration')
@ApiCookieAuth()
@ApiErrorResponse(unauthenticated(PATH))
@ApiErrorResponse(forbidden(PATH))
@Roles(Role.ADMIN)
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'List the audit log of admin actions (GEN-07)',
    description:
      'Newest first, pages of 10 (GEN-05). Suspensions, reactivations, ' +
      'password resets, moderator creation, provider deactivation and every ' +
      'moderation decision (hide, restore, delete, dismiss) are recorded. ' +
      'Read-only: rows can never be changed or removed.',
  })
  @ApiPaginatedResponse(AuditLogDto)
  @ApiErrorResponse(
    validationFailed(PATH, [
      { field: 'action', messages: ['action must be one of the following values: ...'] },
    ]),
  )
  list(@Query() query: AuditLogsQueryDto): Promise<PageDto<AuditLogDto>> {
    const { page, ...filters } = query;
    return this.audit.list(page, filters);
  }
}
