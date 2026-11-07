import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '../constants';

/** Shape B2 expects on `req.user` (set by the team's authentication guard / JWT strategy). */
export class AuthUser {
  userId!: string;
  role!: Role;
}

export const ROLES_KEY = 'b2_roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Normalises the common JWT payload shapes ({userId} | {id} | {_id} | {sub}) into AuthUser. */
export function normaliseUser(raw: any): AuthUser | null {
  if (!raw) return null;
  const userId = raw.userId ?? raw.id ?? raw._id ?? raw.sub;
  if (!userId || !raw.role) return null;
  return { userId: String(userId), role: raw.role as Role };
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return normaliseUser(ctx.switchToHttp().getRequest().user) as AuthUser;
});
