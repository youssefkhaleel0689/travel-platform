import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { Role } from './auth.enums';

export const ROLES_KEY = 'roles';

/**
 * The roles allowed on a route (ACC-11). Checked by RolesGuard after authentication: a
 * logged-in user with another role gets 403. Without @Roles any logged-in user may call it.
 */
export function Roles(...roles: Role[]): CustomDecorator<string> {
  // @Roles() with no role would lock everyone out; fail when the class is loaded instead.
  if (roles.length === 0) {
    throw new Error('@Roles() needs at least one role');
  }
  return SetMetadata(ROLES_KEY, roles);
}
