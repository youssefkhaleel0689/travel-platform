import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserStatus } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { ALLOW_PASSWORD_CHANGE_PENDING_KEY } from '../../common/auth/password-change-pending.decorator';
import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import { AccessTokenService } from '../tokens/access-token.service';
import { UsersService } from '../users/users.service';

export function unauthenticated(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'UNAUTHENTICATED',
    message: 'Authentication required',
  });
}

function accessTokenCookie(request: Request): string | undefined {
  // cookie-parser sets request.cookies; it is typed loosely, so narrow it here.
  const cookies: unknown = request.cookies;
  if (typeof cookies !== 'object' || cookies === null) {
    return undefined;
  }
  const token: unknown = Reflect.get(cookies, ACCESS_TOKEN_COOKIE);
  return typeof token === 'string' && token !== '' ? token : undefined;
}

/**
 * Global authentication guard (ACC-04, ACC-19), registered as APP_GUARD before RolesGuard.
 *
 * Secure by default: every route requires a logged-in user unless it is marked @Public().
 *
 * The user is loaded from the database on every request instead of trusting the token alone,
 * so a suspension, a deactivation or a role change applies at once, not when the token
 * expires. The role in request.user always comes from the database.
 *
 * Public routes still read a valid cookie, because some behave differently for a logged-in
 * user (GET /api/airlines/:id shows a deactivated airline to its admin or moderator). A
 * missing or bad cookie on a public route is never rejected; request.user stays undefined.
 *
 * On a protected route every failure (no cookie, bad or expired token, unknown user, a
 * status other than ACTIVE) gives the same 401, so the response does not reveal which.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<Request>();

    const user = await this.authenticate(request);
    if (user) {
      request.user = user;
      this.assertPasswordChangeDone(context, user);
      return true;
    }
    if (isPublic) {
      return true;
    }
    throw unauthenticated();
  }

  /**
   * ACC-07a, ACC-13: an account on a temporary password set by an admin must
   * choose its own before it can do anything else, so every route is refused
   * except the ones marked @AllowPasswordChangePending().
   *
   * Without this the flag on the user would be recorded and never enforced, and
   * a temporary password would give full access.
   */
  private assertPasswordChangeDone(
    context: ExecutionContext,
    user: AuthenticatedUser,
  ): void {
    if (!user.mustChangePassword) {
      return;
    }
    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_PASSWORD_CHANGE_PENDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) {
      return;
    }
    throw new ForbiddenException({
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'A new password must be set before continuing',
    });
  }

  // The user behind the request's cookie, or undefined for any failure.
  private async authenticate(
    request: Request,
  ): Promise<AuthenticatedUser | undefined> {
    const token = accessTokenCookie(request);
    if (!token) {
      return undefined;
    }
    const verified = await this.accessTokens.verify(token);
    if (!verified) {
      return undefined;
    }
    const profile = await this.users.findById(verified.userId);
    if (!profile || profile.status !== UserStatus.ACTIVE) {
      return undefined;
    }
    return {
      userId: profile.id,
      role: profile.role,
      mustChangePassword: profile.mustChangePassword,
    };
  }
}
