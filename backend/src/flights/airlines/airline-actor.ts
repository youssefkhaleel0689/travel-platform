import { ForbiddenException } from '@nestjs/common';

// Roles stored on users (schema section 6). Guest is anonymous and has no actor.
export type ActorRole =
  'USER' | 'ADMIN' | 'AIRLINE_MODERATOR' | 'HOTEL_MODERATOR';

// The logged-in user as the airline code needs to see them.
export interface AirlineActor {
  userId: string;
  role: ActorRole;
}

// What the controllers read the actor from. The auth guard (ACC-04) will set `user`.
export interface RequestWithActor {
  user?: AirlineActor;
}

// TODO(ACC-04): temporary. There is no auth in develop yet, so write endpoints run as
// this admin. Delete this constant and resolveWriteActor() when the guards are merged.
const PLACEHOLDER_ADMIN: AirlineActor = {
  userId: '000000000000000000000000',
  role: 'ADMIN',
};

// TODO(ACC-04): replace with the real current-user decorator and role guard.
export function resolveWriteActor(request: RequestWithActor): AirlineActor {
  return request.user ?? PLACEHOLDER_ADMIN;
}

export function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: 'FORBIDDEN', message });
}
