import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PageDto } from '../common/pagination/dto/page.dto';
import { Role } from '../auth/enums/role.enum';
import { UserStatus } from '../auth/enums/user-status.enum';
import { AccountListFilters, UsersService } from '../auth/users.service';
import {
  NotificationResourceType,
  NotificationType,
} from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly notifications: NotificationsService,
  ) {}

  /** ACC-14: paginated, searchable, filterable list of every account. */
  async listAccounts(
    page: number,
    filters: AccountListFilters,
  ): Promise<PageDto<AdminAccountDto>> {
    const result = await this.users.listAccounts(page, filters);
    return new PageDto(
      result.items.map((item) => AdminAccountDto.from(item)),
      result.meta,
    );
  }

  /**
   * ACC-16: suspends an account. The account cannot log in afterwards and its
   * open sessions end at once, while its bookings stay valid (GEN-11 is not
   * touched). The owner is told in the app (ACC-15, GEN-01).
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
    if (updated) {
      await this.notifications.notify({
        userId: updated._id,
        type: NotificationType.ACCOUNT_SUSPENDED,
        title: 'Account suspended',
        message:
          'An administrator suspended your account. You cannot sign in until ' +
          'it is reactivated. Existing bookings remain valid.',
        resourceType: NotificationResourceType.ACCOUNT,
        resourceId: updated._id.toString(),
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

    const { user, temporaryPassword } =
      await this.users.resetPasswordToTemporary(targetUserId);

    const dto = new TemporaryPasswordDto();
    dto.userId = user._id.toString();
    dto.email = user.email;
    dto.temporaryPassword = temporaryPassword;
    dto.message =
      'Give this password to the account owner. It cannot be shown again.';
    return dto;
  }

  /** The two rules every admin action on an account shares. */
  private async assertManageable(actorId: string, targetUserId: string) {
    const target = await this.users.findByIdOrThrow(targetUserId);

    if (target._id.toString() === actorId) {
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
