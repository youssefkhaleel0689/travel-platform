import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../auth/users/users.service';
import { Role } from '../common/auth/auth.enums';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ContentType } from '../common/moderation/content-moderation.port';
import { ModerationState } from '../common/moderation/moderation-state';
import { ContentModerationGateway } from './content-moderation.gateway';
import { ModerationService } from './moderation.service';
import { ReportDecision, ReportReason, ReportStatus } from './report.enums';

const REPORTER = '6720f1c2a1b2c3d4e5f60702';
const AUTHOR = '6720f1c2a1b2c3d4e5f60701';
const ADMIN = '6720f1c2a1b2c3d4e5f60703';
const POST = '6720f1c2a1b2c3d4e5f60718';
const REPORT = '6720f1c2a1b2c3d4e5f60740';

const user = (userId: string, role = Role.USER): AuthenticatedUser => ({
  userId,
  role,
  sessionId: '6720f1c2a1b2c3d4e5f60799',
});

function exec<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function openReport() {
  return {
    _id: new Types.ObjectId(REPORT),
    reporterId: new Types.ObjectId(REPORTER),
    targetType: ContentType.POST,
    targetId: new Types.ObjectId(POST),
    reason: ReportReason.SPAM,
    details: null,
    status: ReportStatus.OPEN,
    reviewerId: null,
    reviewedAt: null,
    createdAt: new Date(),
  };
}

describe('ModerationService (GEN-09, GEN-10)', () => {
  let reports: {
    create: jest.Mock;
    findById: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
  };
  let content: { find: jest.Mock; moderate: jest.Mock };
  let audit: { record: jest.Mock };
  let service: ModerationService;

  beforeEach(() => {
    reports = {
      create: jest.fn(async (doc: Record<string, unknown>) => ({
        toObject: () => ({
          _id: new Types.ObjectId(),
          createdAt: new Date(),
          status: ReportStatus.OPEN,
          reviewerId: null,
          reviewedAt: null,
          ...doc,
        }),
      })),
      findById: jest.fn(() => ({ lean: () => exec(openReport()) })),
      updateOne: jest.fn(() => exec({ matchedCount: 1 })),
      updateMany: jest.fn(() => exec({ modifiedCount: 2 })),
    };
    content = {
      find: jest.fn().mockResolvedValue({
        id: POST,
        ownerId: AUTHOR,
        moderationState: ModerationState.VISIBLE,
        reportable: true,
        preview: 'Three days in Luxor',
      }),
      moderate: jest.fn().mockResolvedValue({
        before: ModerationState.VISIBLE,
        after: ModerationState.HIDDEN,
        changed: true,
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ModerationService(
      reports as never,
      content as unknown as ContentModerationGateway,
      audit as unknown as AuditService,
      {
        findBriefsByIds: jest.fn().mockResolvedValue(new Map()),
      } as unknown as UsersService,
    );
  });

  const reportBody = {
    targetType: ContentType.POST,
    targetId: POST,
    reason: ReportReason.SPAM,
  };

  describe('report', () => {
    it('records a report of visible content', async () => {
      const dto = await service.report(user(REPORTER), reportBody);
      expect(dto.status).toBe(ReportStatus.OPEN);
      expect(reports.create).toHaveBeenCalledWith(
        expect.objectContaining({ reason: ReportReason.SPAM, details: null }),
      );
    });

    it('answers 404 for content the reporter cannot see', async () => {
      content.find.mockResolvedValue({ ownerId: AUTHOR, reportable: false });
      await expect(
        service.report(user(REPORTER), reportBody),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses your own content', async () => {
      await expect(
        service.report(user(AUTHOR), reportBody),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('turns a second report of the same item into 409 ALREADY_REPORTED', async () => {
      reports.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 11000 }),
      );
      await expect(
        service.report(user(REPORTER), reportBody),
      ).rejects.toMatchObject({
        response: { code: 'ALREADY_REPORTED' },
      });
    });
  });

  describe('resolve', () => {
    it('HIDE hides the item, closes its open reports and audits it', async () => {
      await service.resolve(
        REPORT,
        ReportDecision.HIDE,
        user(ADMIN, Role.ADMIN),
      );

      expect(content.moderate).toHaveBeenCalledWith(
        ContentType.POST,
        POST,
        ModerationState.HIDDEN,
        ADMIN,
      );
      expect(reports.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReportStatus.OPEN }),
        { $set: expect.objectContaining({ status: ReportStatus.HIDDEN }) },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CONTENT_HIDDEN,
          entityId: POST,
          after: expect.objectContaining({
            reportId: REPORT,
            reportsClosed: 2,
          }),
        }),
      );
    });

    it('DISMISS leaves the content alone and audits the report', async () => {
      await service.resolve(
        REPORT,
        ReportDecision.DISMISS,
        user(ADMIN, Role.ADMIN),
      );
      expect(content.moderate).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.REPORT_DISMISSED,
          entityId: REPORT,
        }),
      );
    });

    it('refuses a report that is already resolved', async () => {
      reports.findById.mockReturnValue({
        lean: () => exec({ ...openReport(), status: ReportStatus.DISMISSED }),
      });
      await expect(
        service.resolve(REPORT, ReportDecision.HIDE, user(ADMIN, Role.ADMIN)),
      ).rejects.toMatchObject({
        response: { code: 'REPORT_ALREADY_RESOLVED' },
      });
    });

    it('answers 409 CONTENT_GONE when the author already deleted the item', async () => {
      content.moderate.mockResolvedValue(null);
      await expect(
        service.resolve(REPORT, ReportDecision.DELETE, user(ADMIN, Role.ADMIN)),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('act (direct moderation)', () => {
    it('does not audit or close reports when nothing changed', async () => {
      content.moderate.mockResolvedValue({
        before: ModerationState.HIDDEN,
        after: ModerationState.HIDDEN,
        changed: false,
      });
      const outcome = await service.act(
        ContentType.POST,
        POST,
        ModerationState.HIDDEN,
        user(ADMIN, Role.ADMIN),
      );
      expect(outcome.changed).toBe(false);
      expect(audit.record).not.toHaveBeenCalled();
      expect(reports.updateMany).not.toHaveBeenCalled();
    });

    it('restoring does not close reports but is audited', async () => {
      content.moderate.mockResolvedValue({
        before: ModerationState.HIDDEN,
        after: ModerationState.VISIBLE,
        changed: true,
      });
      await service.act(
        ContentType.COMMENT,
        POST,
        ModerationState.VISIBLE,
        user(ADMIN, Role.ADMIN),
      );
      expect(reports.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CONTENT_RESTORED }),
      );
    });
  });
});
