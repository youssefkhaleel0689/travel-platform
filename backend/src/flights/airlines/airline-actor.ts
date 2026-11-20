import { ForbiddenException } from '@nestjs/common';
import type { Role } from '../../common/auth/auth.enums';

// The role as a plain string ('ADMIN', ...). Both Role.ADMIN from the auth enum and the
// literal 'ADMIN' fit, so the logged-in user and other modules' callers can use it.
export type ActorRole = `${Role}`;

// What the airline service needs to know about the caller. The logged-in user
// (AuthenticatedUser: userId, role, sessionId) fits this shape; the controller passes it
// straight in. A guest has no actor.
export interface AirlineActor {
  userId: string;
  role: ActorRole;
}

export function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: 'FORBIDDEN', message });
}
