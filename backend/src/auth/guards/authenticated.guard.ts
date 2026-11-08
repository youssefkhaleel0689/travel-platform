import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import { AuthTokensService } from '../auth-tokens.service';
import { ALLOW_PASSWORD_CHANGE_PENDING_KEY } from '../decorators/allow-password-change-pending.decorator';
import { UserStatus } from '../enums/user-status.enum';
import { SessionsService } from '../sessions.service';
import { UsersService } from '../users.service';
import { RequestWithUser } from '../types/authenticated-user';

/**
 * Turns the access-token cookie into a verified account on the request
 * (ACC-04, ACC-06, ACC-11, ACC-19, GEN-13).
 *
 * Four checks run on every request, in this order, because each one can
 * invalidate a token that is still cryptographically valid:
 *
 *  1. the JWT verifies and has not expired;
 *  2. the session exists, is not revoked and has been active in the last
 *     30 minutes - and the same atomic update records this request as
 *     activity (ACC-06);
 *  3. the account still exists and its status is ACTIVE, so suspension
 *     (ACC-16) and deactivation (ACC-12) take effect at once rather than when
 *     the token expires;
 *  4. the account is not sitting on a temporary password (ACC-07a).
 *
 * The role is read from the database, never from the token, so an admin who
 * loses the role cannot keep using an old cookie.
 */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(
    private readonly tokens: AuthTokensService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & RequestWithUser>();

    const token = this.readAccessTokenCookie(request);
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    let payload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch {
      // Expired or tampered with; the client has to log in again. The reason is
      // deliberately not detailed, so nothing about the token is leaked.
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Authentication required',
      });
    }

    const session = await this.sessions.touchIfUsable(payload.sid);
    if (!session) {
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
        message: 'Session expired, please log in again',
      });
    }

    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Account suspended',
      });
    }
    if (user.status === UserStatus.DEACTIVATED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'Account deactivated',
      });
    }

    if (user.mustChangePassword && !this.allowsPasswordChangePending(context)) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'A new password must be set before continuing',
      });
    }

    request.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      sessionId: session._id.toString(),
    };
    return true;
  }

  private readAccessTokenCookie(request: Request): string | undefined {
    // cookie-parser fills request.cookies; the check keeps the guard working
    // (by refusing access) even if the middleware is ever missing.
    const cookies = (request as Request & { cookies?: Record<string, string> })
      .cookies;
    const value = cookies?.[ACCESS_TOKEN_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private allowsPasswordChangePending(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(
        ALLOW_PASSWORD_CHANGE_PENDING_KEY,
        [context.getHandler(), context.getClass()],
      ) === true
    );
  }
}
