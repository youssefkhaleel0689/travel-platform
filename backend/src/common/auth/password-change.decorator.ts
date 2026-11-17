import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_KEY =
  'allowWhenPasswordChangeRequired';

/**
 * A user whose mustChangePassword flag is set (an admin-created moderator, ACC-13, or an
 * admin password reset, ACC-07a) gets 403 PASSWORD_CHANGE_REQUIRED on every protected route
 * until the password is changed. Mark the few routes such a user still needs (who am I,
 * change password) with this decorator, on a method or a class. @Public routes are never
 * affected and need nothing.
 */
export function AllowWhenPasswordChangeRequired(): CustomDecorator<string> {
  return SetMetadata(ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_KEY, true);
}
