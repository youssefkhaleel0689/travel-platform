import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_PENDING_KEY = 'auth:allowPasswordChangePending';

/**
 * ACC-07a, ACC-13: an account on a temporary password must set a new one before
 * it can use the platform. AuthenticatedGuard therefore rejects every
 * authenticated route with 403 PASSWORD_CHANGE_REQUIRED while that flag is set.
 *
 * Mark the change-password route (and logout) with this decorator so the
 * account has a way out.
 */
export const AllowPasswordChangePending = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);
