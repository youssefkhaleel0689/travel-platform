import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { AuditAction, AuditEntityType } from '../audit-action.enum';

// GEN-07: narrow the audit log by what was done, to what, by whom and when.
export class AuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditEntityType })
  @IsOptional()
  @IsEnum(AuditEntityType)
  entityType?: AuditEntityType;

  @ApiPropertyOptional({
    example: '6720f1c2a1b2c3d4e5f60718',
    description: 'Only rows about this post, comment, account, ...',
  })
  @IsOptional()
  @IsMongoId()
  entityId?: string;

  @ApiPropertyOptional({
    example: '6720f1c2a1b2c3d4e5f60701',
    description: 'Only rows written by this admin',
  })
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00.000Z',
    description: 'Only rows at or after this instant (ISO 8601)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    example: '2026-11-30T23:59:59.999Z',
    description: 'Only rows at or before this instant (ISO 8601)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
