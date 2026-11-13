import { Role } from './auth.enums';

/**
 * The logged-in user: this is request.user, set by the global guard (step E). The role is
 * loaded from the database on every request, so a role change or a suspension applies at
 * once instead of when the token expires. The shape matches AirlineActor in
 * airline-actor.ts, so the flights code can switch to it without changes.
 */
export interface AuthenticatedUser {
  userId: string;
  role: Role;
  /**
   * ACC-07a, ACC-13: true while the account is on a temporary password set by
   * an admin. The guard refuses every route but the ones marked
   * @AllowPasswordChangePending() until the account chooses its own.
   */
  mustChangePassword: boolean;
}

// No installed type package declares Request.user (there is no @types/passport), so it is
// declared here. It is undefined on a public route when there is no valid cookie.
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
