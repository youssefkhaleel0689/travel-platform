import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { RequestWithUser } from '../types/authenticated-user';

/**
 * ACC-11: checks the account's role against @Roles(...). It must run after
 * AuthenticatedGuard, which is the case when both are listed in one
 * @UseGuards(AuthenticatedGuard, RolesGuard) in that order.
 *
 * A route with no @Roles is open to every signed-in account.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      // AuthenticatedGuard is missing from this route: refuse rather than
      // treat an anonymous request as allowed.
      throw new ForbiddenException('Insufficient permissions');
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Insufficient permissions',
      });
    }
    return true;
  }
}
