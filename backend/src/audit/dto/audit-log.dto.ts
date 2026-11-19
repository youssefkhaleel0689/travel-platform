import { ApiProperty } from '@nestjs/swagger';
import type { LeanDoc } from '../../common/pagination/paginate';
import { AuditAction, AuditEntityType } from '../audit-action.enum';
import type { AuditLog } from '../schemas/audit-log.schema';

export class AuditLogDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60730' })
  id: string;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60701' })
  actorId: string;

  @ApiProperty({
    example: 'Platform Admin',
    nullable: true,
    description: 'Name of the admin who acted; null if that account is gone',
  })
  actorName: string | null;

  @ApiProperty({ enum: AuditAction, example: AuditAction.CONTENT_HIDDEN })
  action: AuditAction;

  @ApiProperty({ enum: AuditEntityType, example: AuditEntityType.POST })
  entityType: AuditEntityType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  entityId: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { moderationState: 'VISIBLE' },
  })
  before: Record<string, unknown> | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: {
      moderationState: 'HIDDEN',
      reportId: '6720f1c2a1b2c3d4e5f60740',
    },
  })
  after: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  createdAt: string;

  static from(row: LeanDoc<AuditLog>, actorName: string | null): AuditLogDto {
    const dto = new AuditLogDto();
    dto.id = row._id.toString();
    dto.actorId = row.actorId.toString();
    dto.actorName = actorName;
    dto.action = row.action;
    dto.entityType = row.entityType;
    dto.entityId = row.entityId.toString();
    dto.before = row.before ?? null;
    dto.after = row.after ?? null;
    dto.createdAt = row.createdAt.toISOString();
    return dto;
  }
}
