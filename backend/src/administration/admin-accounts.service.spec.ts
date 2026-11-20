import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PageDto, PageMetaDto } from '../common/pagination/dto/page.dto';
import { Role, UserStatus } from '../common/auth/auth.enums';
import { SessionsService } from '../auth/sessions/sessions.service';
import { UsersService } from '../auth/users/users.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditAction, AuditEntityType } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { AdminAccountsService } from './admin-accounts.service';

describe('AdminAccountsService', () => {
  const ADMIN_ID = '6720f1c2a1b2c3d4e5f60001';
  const TARGET_ID = '6720f1c2a1b2c3d4e5f60002';

  let users: jest.Mocked<
    Pick<
      UsersService,
      | 'findByIdOrThrow'
      | 'listAccounts'
      | 'setStatus'
      | 'resetPasswordToTemporary'
    >
  >;
  let sessions: jest.Mocked<Pick<SessionsService, 'revokeAllSessions'>>;
  let notifications: jest.Mocked<Pick<NotificationsService, 'notify'>>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: AdminAccountsService;

  function account(overrides: Record<string, unknown> = {}) {
    return {
      id: TARGET_ID,
      name: 'Target User',
      email: 'target@example.com',
      role: Role.USER,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      mustChangePassword: false,
      suspendedAt: null,
      deactivatedAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    users = {
      findByIdOrThrow: jest.fn().mockResolvedValue(account()),
      listAccounts: jest
        .fn()
        .mockResolvedValue(new PageDto([], PageMetaDto.create(1, 0))),
      setStatus: jest.fn().mockResolvedValue(account()),
      resetPasswordToTemporary: jest.fn().mockResolvedValue({
        profile: account(),
        temporaryPassword: 'Tmpabcde12349',
      }),
    };
    sessions = { revokeAllSessions: jest.fn().mockResolvedValue(1) };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    service = new AdminAccountsService(
      users as unknown as UsersService,
      sessions as unknown as SessionsService,
      notifications as unknown as NotificationsService,
      audit as unknown as AuditService,
    );
  });

  describe('listAccounts (ACC-14)', () => {
    it('passes the filters through and maps to the admin row', async () => {
      users.listAccounts.mockResolvedValue(
        new PageDto([account()], PageMetaDto.create(1, 1)) as never,
      );

      const result = await service.listAccounts(2, {
        search: 'target',
        role: Role.USER,
        status: UserStatus.ACTIVE,
      });

      expect(users.listAccounts).toHaveBeenCalledWith(2, {
        search: 'target',
        role: Role.USER,
        status: UserStatus.ACTIVE,
      });
      expect(result.items[0]).toEqual({
        id: TARGET_ID,
        name: 'Target User',
        email: 'target@example.com',
        role: Role.USER,
        status: UserStatus.ACTIVE,
        createdAt: '2026-11-01T00:00:00.000Z',
        mustChangePassword: false,
        suspendedAt: null,
        deactivatedAt: null,
      });
      // No credential field reaches the row.
      expect(result.items[0]).not.toHaveProperty('passwordHash');
    });
  });

  describe('suspend (ACC-16)', () => {
    it('suspends and notifies the owner', async () => {
      users.setStatus.mockResolvedValue(
        account({
          status: UserStatus.SUSPENDED,
          suspendedAt: new Date(),
        }) as never,
      );

      const result = await service.suspend(ADMIN_ID, TARGET_ID);

      expect(users.setStatus).toHaveBeenCalledWith(
        TARGET_ID,
        UserStatus.SUSPENDED,
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.ACCOUNT_SUSPENDED }),
      );
      expect(result.status).toBe(UserStatus.SUSPENDED);
    });

    it('writes the suspension to the audit log (GEN-07)', async () => {
      users.setStatus.mockResolvedValue(
        account({ status: UserStatus.SUSPENDED }) as never,
      );

      await service.suspend(ADMIN_ID, TARGET_ID);

      expect(audit.record).toHaveBeenCalledWith({
        actorId: ADMIN_ID,
        action: AuditAction.ACCOUNT_SUSPENDED,
        entityType: AuditEntityType.ACCOUNT,
        entityId: TARGET_ID,
        before: { status: UserStatus.ACTIVE },
        after: { status: UserStatus.SUSPENDED },
      });
    });

    it('ends every session of the suspended account (ACC-06)', async () => {
      users.setStatus.mockResolvedValue(
        account({ status: UserStatus.SUSPENDED }) as never,
      );

      await service.suspend(ADMIN_ID, TARGET_ID);

      // No exceptSessionId: the admin is suspending someone else, so there is
      // no session of the target's worth keeping.
      expect(sessions.revokeAllSessions).toHaveBeenCalledWith(TARGET_ID);
    });

    it('is idempotent: suspending again changes nothing and sends no notice', async () => {
      users.findByIdOrThrow.mockResolvedValue(
        account({ status: UserStatus.SUSPENDED }) as never,
      );
      // setStatus returns null when the status already matches.
      users.setStatus.mockResolvedValue(null);

      const result = await service.suspend(ADMIN_ID, TARGET_ID);

      expect(result.status).toBe(UserStatus.SUSPENDED);
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      // Sessions are still revoked: one that somehow outlived the first
      // suspension should not outlive this one either.
      expect(sessions.revokeAllSessions).toHaveBeenCalledWith(TARGET_ID);
    });

    // Protects the platform from being locked out of its own administration.
    it('refuses to suspend an admin account (403)', async () => {
      users.findByIdOrThrow.mockResolvedValue(
        account({ role: Role.ADMIN }) as never,
      );

      await expect(service.suspend(ADMIN_ID, TARGET_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(users.setStatus).not.toHaveBeenCalled();
    });

    it('refuses to act on the admin’s own account (400)', async () => {
      users.findByIdOrThrow.mockResolvedValue(
        account({ id: ADMIN_ID }) as never,
      );

      await expect(service.suspend(ADMIN_ID, ADMIN_ID)).rejects.toMatchObject({
        response: { code: 'CANNOT_TARGET_SELF' },
      });
    });

    it('refuses an account its owner deactivated (400)', async () => {
      users.findByIdOrThrow.mockResolvedValue(
        account({ status: UserStatus.DEACTIVATED }) as never,
      );

      await expect(service.suspend(ADMIN_ID, TARGET_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(users.setStatus).not.toHaveBeenCalled();
    });

    it('passes a missing account straight through as 404', async () => {
      users.findByIdOrThrow.mockRejectedValue(new NotFoundException());

      await expect(service.suspend(ADMIN_ID, TARGET_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivate (ACC-16)', () => {
    it('sets the account back to ACTIVE', async () => {
      users.findByIdOrThrow.mockResolvedValue(
        account({ status: UserStatus.SUSPENDED }) as never,
      );
      users.setStatus.mockResolvedValue(
        account({ status: UserStatus.ACTIVE }) as never,
      );

      const result = await service.reactivate(ADMIN_ID, TARGET_ID);

      expect(users.setStatus).toHaveBeenCalledWith(
        TARGET_ID,
        UserStatus.ACTIVE,
      );
      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ACCOUNT_REACTIVATED,
          before: { status: UserStatus.SUSPENDED },
          after: { status: UserStatus.ACTIVE },
        }),
      );
    });

    // ACC-12 is the owner's decision, so an admin does not undo it.
    it('refuses an account its owner deactivated (400)', async () => {
      users.findByIdOrThrow.mockResolvedValue(
        account({ status: UserStatus.DEACTIVATED }) as never,
      );

      await expect(service.reactivate(ADMIN_ID, TARGET_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(users.setStatus).not.toHaveBeenCalled();
    });

    it('refuses an admin account (403)', async () => {
      users.findByIdOrThrow.mockResolvedValue(
        account({ role: Role.ADMIN }) as never,
      );

      await expect(service.reactivate(ADMIN_ID, TARGET_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('resetPassword (ACC-07a)', () => {
    it('returns the temporary password once, with a warning', async () => {
      const result = await service.resetPassword(ADMIN_ID, TARGET_ID);

      expect(users.resetPasswordToTemporary).toHaveBeenCalledWith(TARGET_ID);
      expect(result).toEqual({
        userId: TARGET_ID,
        email: 'target@example.com',
        temporaryPassword: 'Tmpabcde12349',
        message: expect.stringContaining('cannot be shown again'),
      });
    });

    it('ends every session of the account whose password was reset (ACC-06)', async () => {
      await service.resetPassword(ADMIN_ID, TARGET_ID);

      // Otherwise a device already signed in would keep working on the old
      // password, and the temporary password would not be the only way back in.
      expect(sessions.revokeAllSessions).toHaveBeenCalledWith(TARGET_ID);
    });

    it('refuses an admin account and the admin’s own account', async () => {
      users.findByIdOrThrow.mockResolvedValue(
        account({ role: Role.ADMIN }) as never,
      );
      await expect(service.resetPassword(ADMIN_ID, TARGET_ID)).rejects.toThrow(
        ForbiddenException,
      );

      users.findByIdOrThrow.mockResolvedValue(
        account({ id: ADMIN_ID }) as never,
      );
      await expect(service.resetPassword(ADMIN_ID, ADMIN_ID)).rejects.toThrow(
        BadRequestException,
      );

      expect(users.resetPasswordToTemporary).not.toHaveBeenCalled();
      expect(sessions.revokeAllSessions).not.toHaveBeenCalled();
    });
  });
});
