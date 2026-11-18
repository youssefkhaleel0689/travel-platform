import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import { PageDto } from '../common/pagination/dto/page.dto';
import { paginateQuery } from '../common/pagination/paginate';
import { AuditAction, AuditEntityType } from './audit-action.enum';
import { AuditLogDto } from './dto/audit-log.dto';
import { AuditLog } from './schemas/audit-log.schema';

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface AuditLogFilters {
  action?: AuditAction;
  entityType?: AuditEntityType;
  entityId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
}

/**
 * GEN-07: the one place admin actions are written to and read from. The admin
 * module (C2), moderation (D2) and provider deactivation (B1, A2) all record
 * through record(); nothing else touches the auditLogs collection.
 *
 * ```ts
 * // your.module.ts
 * @Module({ imports: [AuditModule] })
 *
 * // after the action has succeeded
 * await this.audit.record({
 *   actorId: admin.userId,
 *   action: AuditAction.PROVIDER_DEACTIVATED,
 *   entityType: AuditEntityType.HOTEL,
 *   entityId: hotelId,
 *   before: { status: 'ACTIVE' },
 *   after: { status: 'DEACTIVATED' },
 * });
 * ```
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLog>,
    private readonly users: UsersService,
  ) {}

  /**
   * Appends one row. Call it after the action succeeded, so the log never
   * claims something that did not happen.
   *
   * It never throws, like NotificationsService.notify: the action has already
   * taken effect, so failing the request would tell the admin it did not.
   * A failure is logged as an error with everything needed to add the row by
   * hand. Do not wrap it in try/catch.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditModel.create({
        actorId: new Types.ObjectId(entry.actorId),
        action: entry.action,
        entityType: entry.entityType,
        entityId: new Types.ObjectId(entry.entityId),
        before: entry.before ?? null,
        after: entry.after ?? null,
      });
    } catch (error) {
      this.logger.error(
        `Audit row not written: ${entry.action} on ${entry.entityType} ` +
          `${entry.entityId} by ${entry.actorId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** The admin list (GEN-07): newest first, 10 to a page, with actor names. */
  async list(
    page: number,
    filters: AuditLogFilters = {},
  ): Promise<PageDto<AuditLogDto>> {
    const filter: QueryFilter<AuditLog> = {};
    if (filters.action) {
      filter.action = filters.action;
    }
    if (filters.entityType) {
      filter.entityType = filters.entityType;
    }
    if (filters.entityId) {
      filter.entityId = new Types.ObjectId(filters.entityId);
    }
    if (filters.actorId) {
      filter.actorId = new Types.ObjectId(filters.actorId);
    }
    if (filters.from || filters.to) {
      filter.createdAt = {
        ...(filters.from && { $gte: filters.from }),
        ...(filters.to && { $lte: filters.to }),
      };
    }

    const result = await paginateQuery(this.auditModel, filter, {
      page,
      sort: { createdAt: -1, _id: -1 },
    });
    const actors = await this.users.findBriefsByIds(
      result.items.map((row) => row.actorId.toString()),
    );
    return new PageDto(
      result.items.map((row) =>
        AuditLogDto.from(row, actors.get(row.actorId.toString())?.name ?? null),
      ),
      result.meta,
    );
  }
}
