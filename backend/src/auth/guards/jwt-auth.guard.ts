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
import { ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_KEY } from '../../common/auth/password-change.decorator';
import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import { SessionsService } from '../sessions/sessions.service';
import { AccessTokenService } from '../tokens/access-token.service';
import { UsersService } from '../users/users.service';

export function unauthenticated(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'UNAUTHENTICATED',
    message: 'Authentication required',
  });
}

// 403, not 401: the user is logged in, but must change the password first (ACC-07a, ACC-13).
export function passwordChangeRequired(): ForbiddenException {
  return new ForbiddenException({
    code: 'PASSWORD_CHANGE_REQUIRED',
    message: 'password change required',
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
 * On a protected route every failure (no cookie, bad or expired token, a session that is
 * revoked, idle or past its end (ACC-06), unknown user, a status other than ACTIVE) gives the
 * same 401, so the response does not reveal which.
 *
 * After all of those checks pass, a user whose mustChangePassword flag is set gets 403
 * PASSWORD_CHANGE_REQUIRED on a protected route, unless the route or its class is marked
 * @AllowWhenPasswordChangeRequired(). The flag is read from the user loaded on this
 * request, so clearing it takes effect on the next request. Public routes are not affected.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<Request>();

    const authenticated = await this.authenticate(request);
    if (authenticated) {
      if (
        !isPublic &&
        authenticated.mustChangePassword &&
        !this.allowsPendingPasswordChange(context)
      ) {
        throw passwordChangeRequired();
      }
      request.user = authenticated.user;
      return true;
    }
    if (isPublic) {
      return true;
    }
    throw unauthenticated();
  }

  private allowsPendingPasswordChange(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_KEY,
        [context.getHandler(), context.getClass()],
      ) === true
    );
  }

  // The user behind the request's cookie, with the user's mustChangePassword flag as
  // loaded on this request, or undefined for any failure.
  private async authenticate(
    request: Request,
  ): Promise<
    { user: AuthenticatedUser; mustChangePassword: boolean } | undefined
  > {
    const token = accessTokenCookie(request);
    if (!token) {
      return undefined;
    }
    const verified = await this.accessTokens.verify(token);
    if (!verified) {
      return undefined;
    }
    // ACC-06: the token's session must be live (not revoked, idle or past its end). This
    // also records activity for the idle timeout.
    const live = await this.sessions.validateForRequest(
      verified.sessionId,
      verified.userId,
    );
    if (!live) {
      return undefined;
    }
    const profile = await this.users.findById(verified.userId);
    if (!profile || profile.status !== UserStatus.ACTIVE) {
      return undefined;
    }
    // sessionId comes only from the verified token.
    return {
      user: {
        userId: profile.id,
        role: profile.role,
        sessionId: verified.sessionId,
      },
      mustChangePassword: profile.mustChangePassword,
    };
  }
}
