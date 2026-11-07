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
export function normaliseUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const userId = u.userId ?? u.id ?? u._id ?? u.sub;
  if (!userId || !u.role) return null;
  return { userId: String(userId), role: u.role as Role };
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return normaliseUser(ctx.switchToHttp().getRequest().user) as AuthUser;
});
