import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PageDto } from '../common/pagination/dto/page.dto';
import { Role, UserStatus } from '../common/auth/auth.enums';
import { SessionsService } from '../auth/sessions/sessions.service';
import { AccountListFilters, UsersService } from '../auth/users/users.service';
import {
  NotificationResourceType,
  NotificationType,
} from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditAction, AuditEntityType } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { AdminAccountDto } from './dto/admin-account.dto';
import { TemporaryPasswordDto } from './dto/temporary-password.dto';

/**
 * The admin side of account management (ACC-07a, ACC-14, ACC-16).
 *
 * Two rules are enforced here rather than left to the route, because both are
 * ways an admin could lock the platform out of its own administration:
 *  - an admin account is never suspended or reset (ACC-18 seeds them, and
 *    there is no way to re-enable one from inside the API);
 *  - an admin never acts on their own account.
 */
@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** ACC-14: paginated, searchable, filterable list of every account. */
  async listAccounts(
    page: number,
    filters: AccountListFilters,
  ): Promise<PageDto<AdminAccountDto>> {
    const result = await this.users.listAccounts(page, filters);
    return new PageDto(result.items.map((item) => AdminAccountDto.from(item)), result.meta);
  }

  /**
   * ACC-16: suspends an account. It cannot log in afterwards, and the global
   * guard reloads the user on every request, so any token it already holds
   * stops working at once. Its bookings stay valid (GEN-11 is not touched), and
   * the owner is told in the app (ACC-15, GEN-01).
   *
   * Suspending an already-suspended account succeeds and changes nothing, so a
   * repeated click is harmless.
   */
  async suspend(
    actorId: string,
    targetUserId: string,
  ): Promise<AdminAccountDto> {
    const target = await this.assertManageable(actorId, targetUserId);

    if (target.status === UserStatus.DEACTIVATED) {
      throw new BadRequestException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'This account was deactivated by its owner',
      });
    }

    const updated = await this.users.setStatus(
      targetUserId,
      UserStatus.SUSPENDED,
    );
    // ACC-06: end every session of the account, not only its access tokens. The
    // guard already refuses a non-ACTIVE user on every request, but a live
    // session would still let a refresh token rotate, and would come back with
    // the account if an admin reactivates it. Done for an already-suspended
    // account too: revoking an ended session changes nothing, and a session
    // that somehow survived the first suspension should not survive this one.
    await this.sessions.revokeAllSessions(targetUserId);
    if (updated) {
      await this.notifications.notify({
        userId: updated.id,
        type: NotificationType.ACCOUNT_SUSPENDED,
        title: 'Account suspended',
        message:
          'An administrator suspended your account. You cannot sign in until ' +
          'it is reactivated. Existing bookings remain valid.',
        resourceType: NotificationResourceType.ACCOUNT,
        resourceId: updated.id,
      });
      await this.audit.record({
        actorId,
        action: AuditAction.ACCOUNT_SUSPENDED,
        entityType: AuditEntityType.ACCOUNT,
        entityId: updated.id,
        before: { status: target.status },
        after: { status: updated.status },
      });
      return AdminAccountDto.from(updated);
    }

    // Already suspended: nothing changed, so the account as it stands is the
    // right answer.
    return AdminAccountDto.from(target);
  }

  /**
   * ACC-16: reactivates a suspended account, which also clears any login
   * lockout so the owner can sign in straight away.
   *
   * An account the owner deactivated (ACC-12) is deliberately not reactivated
   * here: that decision is the owner's, not an admin's.
   */
  async reactivate(
    actorId: string,
    targetUserId: string,
  ): Promise<AdminAccountDto> {
    const target = await this.assertManageable(actorId, targetUserId);

    if (target.status === UserStatus.DEACTIVATED) {
      throw new BadRequestException({
        code: 'ACCOUNT_DEACTIVATED',
        message:
          'This account was deactivated by its owner and cannot be ' +
          'reactivated by an administrator',
      });
    }

    const updated = await this.users.setStatus(targetUserId, UserStatus.ACTIVE);
    if (updated) {
      await this.audit.record({
        actorId,
        action: AuditAction.ACCOUNT_REACTIVATED,
        entityType: AuditEntityType.ACCOUNT,
        entityId: updated.id,
        before: { status: target.status },
        after: { status: updated.status },
      });
    }

    return AdminAccountDto.from(updated ?? target);
  }

  /**
   * ACC-07a: resets the account to a temporary password, ends all its
   * sessions and marks it as owing a password change. The temporary password is
   * returned once and never stored in readable form.
   */
  async resetPassword(
    actorId: string,
    targetUserId: string,
  ): Promise<TemporaryPasswordDto> {
    await this.assertManageable(actorId, targetUserId);

    const { profile, temporaryPassword } =
      await this.users.resetPasswordToTemporary(targetUserId);
    // ACC-06: the old password is gone, so every session opened with it ends
    // here. Without this the account's other devices would keep working on
    // tokens issued before the reset, and the temporary password would not be
    // the only way back in.
    await this.sessions.revokeAllSessions(profile.id);
    await this.audit.record({
      actorId,
      action: AuditAction.ACCOUNT_PASSWORD_RESET,
      entityType: AuditEntityType.ACCOUNT,
      entityId: profile.id,
      after: { mustChangePassword: true },
    });

    const dto = new TemporaryPasswordDto();
    dto.userId = profile.id;
    dto.email = profile.email;
    dto.temporaryPassword = temporaryPassword;
    dto.message =
      'Give this password to the account owner. It cannot be shown again.';
    return dto;
  }

  /** The two rules every admin action on an account shares. */
  private async assertManageable(actorId: string, targetUserId: string) {
    const target = await this.users.findByIdOrThrow(targetUserId);

    if (target.id === actorId) {
      throw new BadRequestException({
        code: 'CANNOT_TARGET_SELF',
        message: 'An administrator cannot perform this action on their own account',
      });
    }
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException({
        code: 'CANNOT_TARGET_ADMIN',
        message: 'Administrator accounts cannot be managed through the API',
      });
    }
    return target;
  }
}
