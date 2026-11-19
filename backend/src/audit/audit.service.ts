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

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLog>,
    private readonly users: UsersService,
  ) {}

  // Called after the action succeeded. Like notify(), it logs a failure
  // instead of throwing, because the action itself already happened.
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
