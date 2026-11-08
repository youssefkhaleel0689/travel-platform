import { Role } from '../enums/role.enum';

/**
 * What AuthenticatedGuard puts on the request and @CurrentUser() hands to a
 * controller. It is built from the database on every request, not from the
 * token's claims, so a role change or a suspension takes effect immediately.
 */
export interface AuthenticatedUser {
  /** User id as a string, ready for comparisons and responses. */
  id: string;
  email: string;
  name: string;
  role: Role;
  /** The session this request belongs to, so logout can revoke exactly it. */
  sessionId: string;
}

/** The request shape after the guard has run. */
export interface RequestWithUser {
  user?: AuthenticatedUser;
}
