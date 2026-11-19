import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { AuditAction, AuditEntityType } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../auth/users/users.service';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ContentType } from '../common/moderation/content-moderation.port';
import type { ModeratedContent } from '../common/moderation/content-moderation.port';
import { ModerationState } from '../common/moderation/moderation-state';
import { PageDto } from '../common/pagination/dto/page.dto';
import { LeanDoc, paginateQuery } from '../common/pagination/paginate';
import { ContentModerationGateway } from './content-moderation.gateway';
import {
  AdminReportsQueryDto,
  CreateReportDto,
  ModerationOutcomeDto,
  ReportDto,
  ReportedContentDto,
} from './dto/moderation.dto';
import { ReportDecision, ReportStatus } from './report.enums';
import { Report } from './schemas/report.schema';

type LeanReport = LeanDoc<Report>;

const DUPLICATE_KEY = 11000;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** The report status that records each moderation outcome. */
const STATUS_FOR: Readonly<Partial<Record<ModerationState, ReportStatus>>> = {
  [ModerationState.HIDDEN]: ReportStatus.HIDDEN,
  [ModerationState.DELETED]: ReportStatus.DELETED,
};

const AUDIT_ACTION_FOR: Readonly<Record<ModerationState, AuditAction>> = {
  [ModerationState.HIDDEN]: AuditAction.CONTENT_HIDDEN,
  [ModerationState.DELETED]: AuditAction.CONTENT_DELETED,
  [ModerationState.VISIBLE]: AuditAction.CONTENT_RESTORED,
};

function contentNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'CONTENT_NOT_FOUND',
    message: 'Content not found',
  });
}

function reportNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'REPORT_NOT_FOUND',
    message: 'Report not found',
  });
}

function alreadyResolved(): ConflictException {
  return new ConflictException({
    code: 'REPORT_ALREADY_RESOLVED',
    message: 'This report has already been resolved',
  });
}

// GEN-09 reports and GEN-10 admin decisions. Content is only changed through
// its owner's ContentModerationPort; every decision is audited (GEN-07).
@Injectable()
export class ModerationService {
  constructor(
    @InjectModel(Report.name) private readonly reportModel: Model<Report>,
    private readonly content: ContentModerationGateway,
    private readonly audit: AuditService,
    private readonly users: UsersService,
  ) {}

  // GEN-09: reporting

  async report(user: AuthenticatedUser, dto: CreateReportDto): Promise<ReportDto> {
    const target = await this.content.find(dto.targetType, dto.targetId);
    // Content the reporter cannot see (a draft, something hidden) answers
    // like content that does not exist, so a report cannot probe for it.
    if (!target || !target.reportable) {
      throw contentNotFound();
    }
    if (target.ownerId === user.userId) {
      throw new BadRequestException({
        code: 'CANNOT_REPORT_OWN_CONTENT',
        message: 'You cannot report your own content',
      });
    }

    let created;
    try {
      created = await this.reportModel.create({
        reporterId: new Types.ObjectId(user.userId),
        targetType: dto.targetType,
        targetId: new Types.ObjectId(dto.targetId),
        reason: dto.reason,
        details: dto.details ?? null,
      });
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        throw new ConflictException({
          code: 'ALREADY_REPORTED',
          message: 'You have already reported this item',
        });
      }
      throw error;
    }
    return this.toDto(created.toObject() as LeanReport, target, null, false);
  }

  // GEN-10: the admin queue

  /** Oldest first for open reports (a queue); newest first once resolved. */
  async listReports(query: AdminReportsQueryDto): Promise<PageDto<ReportDto>> {
    const filter: QueryFilter<Report> = { status: query.status };
    if (query.targetType) {
      filter.targetType = query.targetType;
    }
    const sort: Record<string, 1 | -1> =
      query.status === ReportStatus.OPEN
        ? { createdAt: 1, _id: 1 }
        : { reviewedAt: -1, _id: -1 };
    const result = await paginateQuery(this.reportModel, filter, {
      page: query.page,
      sort,
    });
    const reporters = await this.users.findBriefsByIds(
      result.items.map((report) => report.reporterId.toString()),
    );
    const items = await Promise.all(
      result.items.map(async (report) =>
        this.toDto(
          report,
          await this.findTarget(report),
          reporters.get(report.reporterId.toString())?.name ?? null,
          true,
        ),
      ),
    );
    return new PageDto(items, result.meta);
  }

  /** GEN-10: resolve one open report. */
  async resolve(
    reportId: string,
    decision: ReportDecision,
    admin: AuthenticatedUser,
  ): Promise<ReportDto> {
    const report = await this.findReport(reportId);
    if (report.status !== ReportStatus.OPEN) {
      throw alreadyResolved();
    }

    if (decision === ReportDecision.DISMISS) {
      const result = await this.reportModel
        .updateOne(
          { _id: report._id, status: ReportStatus.OPEN },
          {
            $set: {
              status: ReportStatus.DISMISSED,
              reviewerId: new Types.ObjectId(admin.userId),
              reviewedAt: new Date(),
            },
          },
        )
        .exec();
      if (result.matchedCount === 0) {
        throw alreadyResolved();
      }
      await this.audit.record({
        actorId: admin.userId,
        action: AuditAction.REPORT_DISMISSED,
        entityType: AuditEntityType.REPORT,
        entityId: report._id.toString(),
        before: { status: ReportStatus.OPEN },
        after: {
          status: ReportStatus.DISMISSED,
          targetType: report.targetType,
          targetId: report.targetId.toString(),
        },
      });
    } else {
      const to =
        decision === ReportDecision.HIDE
          ? ModerationState.HIDDEN
          : ModerationState.DELETED;
      const targetId = report.targetId.toString();
      const outcome = await this.content.moderate(
        report.targetType,
        targetId,
        to,
        admin.userId,
      );
      if (!outcome) {
        throw new ConflictException({
          code: 'CONTENT_GONE',
          message:
            'The reported content no longer exists; dismiss the report instead',
        });
      }
      const reportsClosed = await this.closeOpenReports(
        report.targetType,
        targetId,
        STATUS_FOR[to]!,
        admin.userId,
      );
      // Logged even when the item was already in that state, because the
      // admin still made a decision about this report.
      await this.audit.record({
        actorId: admin.userId,
        action: AUDIT_ACTION_FOR[to],
        entityType: report.targetType as unknown as AuditEntityType,
        entityId: targetId,
        before: { moderationState: outcome.before },
        after: {
          moderationState: outcome.after,
          reportId: report._id.toString(),
          reportsClosed,
        },
      });
    }

    const updated = await this.findReport(reportId);
    return this.toDto(updated, await this.findTarget(updated), null, true);
  }

  // GEN-10: direct action on any item

  // Hide, restore or delete without a report. A repeated action is a no-op;
  // hiding or deleting also closes the item's open reports.
  async act(
    type: ContentType,
    id: string,
    to: ModerationState,
    admin: AuthenticatedUser,
  ): Promise<ModerationOutcomeDto> {
    const outcome = await this.content.moderate(type, id, to, admin.userId);
    if (!outcome) {
      throw contentNotFound();
    }
    let reportsClosed = 0;
    if (outcome.changed) {
      const status = STATUS_FOR[to];
      if (status) {
        reportsClosed = await this.closeOpenReports(type, id, status, admin.userId);
      }
      await this.audit.record({
        actorId: admin.userId,
        action: AUDIT_ACTION_FOR[to],
        entityType: type as unknown as AuditEntityType,
        entityId: id,
        before: { moderationState: outcome.before },
        after: { moderationState: outcome.after, reportsClosed },
      });
    }
    const dto = new ModerationOutcomeDto();
    dto.type = type;
    dto.id = id;
    dto.before = outcome.before;
    dto.after = outcome.after;
    dto.changed = outcome.changed;
    dto.reportsClosed = reportsClosed;
    return dto;
  }


  private async closeOpenReports(
    type: ContentType,
    targetId: string,
    status: ReportStatus,
    adminId: string,
  ): Promise<number> {
    const result = await this.reportModel
      .updateMany(
        {
          targetType: type,
          targetId: new Types.ObjectId(targetId),
          status: ReportStatus.OPEN,
        },
        {
          $set: {
            status,
            reviewerId: new Types.ObjectId(adminId),
            reviewedAt: new Date(),
          },
        },
      )
      .exec();
    return result.modifiedCount;
  }

  private async findReport(id: string): Promise<LeanReport> {
    if (!OBJECT_ID.test(id)) {
      throw reportNotFound();
    }
    const report = await this.reportModel.findById(id).lean<LeanReport>().exec();
    if (!report) {
      throw reportNotFound();
    }
    return report;
  }

  private findTarget(
    report: LeanReport,
  ): Promise<ModeratedContent | null> {
    return this.content.find(report.targetType, report.targetId.toString());
  }

  private toDto(
    report: LeanReport,
    target: ModeratedContent | null,
    reporterName: string | null,
    forAdmin: boolean,
  ): ReportDto {
    const content = new ReportedContentDto();
    content.type = report.targetType;
    content.id = report.targetId.toString();
    content.exists = target !== null;
    if (target && forAdmin) {
      content.moderationState = target.moderationState;
      content.ownerId = target.ownerId;
      content.preview = target.preview;
    }

    const dto = new ReportDto();
    dto.id = report._id.toString();
    dto.target = content;
    dto.reason = report.reason;
    dto.details = report.details ?? null;
    dto.status = report.status;
    dto.reporterId = report.reporterId.toString();
    if (forAdmin) {
      dto.reporterName = reporterName;
    }
    dto.reviewerId = report.reviewerId?.toString() ?? null;
    dto.reviewedAt = report.reviewedAt?.toISOString() ?? null;
    dto.createdAt = report.createdAt.toISOString();
    return dto;
  }
}
