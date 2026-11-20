import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ContentType } from '../../common/moderation/content-moderation.port';
import { ModerationState } from '../../common/moderation/moderation-state';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { trimText } from '../../common/validation/text-transforms';
import {
  REPORT_DETAILS_MAX_LENGTH,
  ReportDecision,
  ReportReason,
  ReportStatus,
} from '../report.enums';

// "post", "Post" and "POST" all mean ContentType.POST in a route or a body,
// like :type in the payment routes.
const toContentType = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** GEN-09: a registered user reports one item, once. */
export class CreateReportDto {
  @ApiProperty({ enum: ContentType, example: ContentType.POST })
  @Transform(toContentType)
  @IsEnum(ContentType)
  targetType: ContentType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  targetId: string;

  @ApiProperty({ enum: ReportReason, example: ReportReason.SPAM })
  @IsEnum(ReportReason)
  reason: ReportReason;

  @ApiPropertyOptional({
    example: 'The same link was posted under every article.',
    maxLength: REPORT_DETAILS_MAX_LENGTH,
    description: 'Required when reason is OTHER',
  })
  @Transform(trimText)
  @ValidateIf((dto: CreateReportDto) => dto.reason === ReportReason.OTHER || dto.details !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'details is required when reason is OTHER' })
  @MaxLength(REPORT_DETAILS_MAX_LENGTH)
  details?: string;
}

/** GEN-10: the admin queue, open reports by default. */
export class AdminReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus, default: ReportStatus.OPEN })
  @IsOptional()
  @IsEnum(ReportStatus)
  status: ReportStatus = ReportStatus.OPEN;

  @ApiPropertyOptional({ enum: ContentType })
  @IsOptional()
  @Transform(toContentType)
  @IsEnum(ContentType)
  targetType?: ContentType;
}

export class ResolveReportDto {
  @ApiProperty({
    enum: ReportDecision,
    example: ReportDecision.HIDE,
    description:
      'DISMISS closes the report and leaves the content alone. HIDE makes ' +
      'the content visible only to its author and admins. DELETE removes it ' +
      'for everyone but admins. HIDE and DELETE also close every other open ' +
      'report on the same item.',
  })
  @IsEnum(ReportDecision)
  decision: ReportDecision;
}

/** :type and :id of /api/admin/content/:type/:id. */
export class ContentParamsDto {
  @ApiProperty({
    enum: ContentType,
    example: 'post',
    description: 'post, comment, review or itinerary (any letter case)',
  })
  @Transform(toContentType)
  @IsEnum(ContentType)
  type: ContentType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  id: string;
}

export class ReportedContentDto {
  @ApiProperty({ enum: ContentType, example: ContentType.POST })
  type: ContentType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({
    example: true,
    description: 'False when its author deleted it in the meantime',
  })
  exists: boolean;

  @ApiPropertyOptional({ enum: ModerationState, example: ModerationState.VISIBLE })
  moderationState?: ModerationState;

  @ApiPropertyOptional({ example: '6720f1c2a1b2c3d4e5f60702' })
  ownerId?: string;

  @ApiPropertyOptional({ example: 'Three days in Luxor' })
  preview?: string;
}

export class ReportDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60740' })
  id: string;

  @ApiProperty({ type: ReportedContentDto })
  target: ReportedContentDto;

  @ApiProperty({ enum: ReportReason, example: ReportReason.SPAM })
  reason: ReportReason;

  @ApiProperty({ example: null, nullable: true })
  details: string | null;

  @ApiProperty({ enum: ReportStatus, example: ReportStatus.OPEN })
  status: ReportStatus;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60701' })
  reporterId: string;

  @ApiPropertyOptional({ example: 'Mona Adel', nullable: true })
  reporterName?: string | null;

  @ApiProperty({ example: null, nullable: true })
  reviewerId: string | null;

  @ApiProperty({ example: null, nullable: true })
  reviewedAt: string | null;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  createdAt: string;
}

/** GEN-10: what a direct admin action did. */
export class ModerationOutcomeDto {
  @ApiProperty({ enum: ContentType, example: ContentType.POST })
  type: ContentType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ enum: ModerationState, example: ModerationState.VISIBLE })
  before: ModerationState;

  @ApiProperty({ enum: ModerationState, example: ModerationState.HIDDEN })
  after: ModerationState;

  @ApiProperty({
    example: true,
    description: 'False when it already was in that state (nothing changed, nothing logged)',
  })
  changed: boolean;

  @ApiProperty({
    example: 2,
    description: 'Open reports on this item that the action closed',
  })
  reportsClosed: number;
}
