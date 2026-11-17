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
   * The current session (ACC-06), taken by the guard from the verified token's sid only;
   * never from the body, query, params or another header. Logout and a password change
   * (ACC-08, keep this session) use it.
   */
  sessionId: string;
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
