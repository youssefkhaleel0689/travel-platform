import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_PENDING_KEY = 'allowPasswordChangePending';

/**
 * ACC-07a, ACC-13: an account on a temporary password must choose its own
 * before it can use the platform, so JwtAuthGuard refuses every authenticated
 * route while `mustChangePassword` is set.
 *
 * Mark the routes that are the way out of that state with this decorator. Today
 * that is only PATCH /api/auth/change-password; logout should get it too when
 * ACC-06 lands, so an account on a temporary password can still sign out.
 */
export function AllowPasswordChangePending(): CustomDecorator<string> {
  return SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);
}
