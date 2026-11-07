import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { normaliseUser, ROLES_KEY } from './auth-user';
import { Role } from '../constants';

/**
 * Requires a logged-in user on req.user and (if @Roles is used) one of the allowed roles.
 * The Auth module (cookie JWT, ACC-04 / ACC-19) must set req.user before this guard runs.
 */
@Injectable()
export class B2AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const user = normaliseUser(ctx.switchToHttp().getRequest().user);
    if (!user) throw new UnauthorizedException('Authentication required');

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
