import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '../../common/auth/auth.enums';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { unauthenticated } from './jwt-auth.guard';

/**
 * Global role guard (ACC-11), registered as APP_GUARD after JwtAuthGuard, so request.user
 * is already set on a protected route. A route without @Roles is open to any logged-in
 * user; with @Roles, a user with another role gets 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<Request>();
    // Only possible when @Roles is combined with @Public and there is no valid cookie.
    if (!user) {
      throw unauthenticated();
    }
    if (!roles.includes(user.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
      });
    }
    return true;
  }
}
