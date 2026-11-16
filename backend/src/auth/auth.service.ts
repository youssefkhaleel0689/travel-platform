import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Role, UserStatus } from '../common/auth/auth.enums';
import { REFRESH_TOKEN_COOKIE } from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { unauthenticated } from './guards/jwt-auth.guard';
import { SessionsService } from './sessions/sessions.service';
import { AccessTokenService } from './tokens/access-token.service';
import {
  clearAccessTokenCookie,
  clearRefreshTokenCookie,
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from './tokens/auth-cookie';
import { UserProfile, UsersService } from './users/users.service';

// The refresh_token cookie, or '' when it is missing or not a string. cookie-parser sets
// request.cookies and types it loosely, so it is narrowed here (as in JwtAuthGuard).
// SessionsService.rotate refuses '' without querying.
function refreshTokenCookie(request: Request): string {
  const cookies: unknown = request.cookies;
  if (typeof cookies !== 'object' || cookies === null) {
    return '';
  }
  const token: unknown = Reflect.get(cookies, REFRESH_TOKEN_COOKIE);
  return typeof token === 'string' ? token : '';
}

/**
 * ACC-05: 423 for a locked account. details.lockedUntil tells the client when to retry, and
 * the exception filter turns retryAfterSeconds into the Retry-After header (whole seconds,
 * rounded up, at least 1); it never appears in the body.
 */
export function accountLocked(
  lockedUntil: Date,
  now = Date.now(),
): HttpException {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - now) / 1000),
  );
  return new HttpException(
    {
      code: 'ACCOUNT_LOCKED',
      message: 'account locked, try again later',
      details: { lockedUntil: lockedUntil.toISOString() },
      retryAfterSeconds,
    },
    HttpStatus.LOCKED,
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * ACC-01: creates a USER account and logs it in. The role is never taken from the
   * request (ACC-01, ACC-18: no admin self-registration).
   */
  async register(dto: RegisterDto, res: Response): Promise<UserProfile> {
    const profile = await this.users.create({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      role: Role.USER,
      termsAcceptedAt: new Date(),
    });
    return this.startSession(res, profile);
  }

  /**
   * ACC-04: logs a user in with email and password, starts a session (ACC-06) and sets the
   * access and refresh token cookies.
   *
   * The status is checked only after the password matches, so a wrong password never
   * reveals whether an account exists or is suspended: it is always 401 INVALID_CREDENTIALS.
   * ACC-05: a locked account gets 423 ACCOUNT_LOCKED, even with the right password. The
   * failure counter is kept by UsersService.verifyCredentials (reset on any right
   * password); nothing here writes to it.
   */
  async login(dto: LoginDto, res: Response): Promise<UserProfile> {
    const result = await this.users.verifyCredentials(dto.email, dto.password);
    if (result.kind === 'invalid') {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'invalid email or password',
      });
    }
    if (result.kind === 'locked') {
      throw accountLocked(result.lockedUntil);
    }
    const { profile } = result;
    if (profile.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'account suspended',
      });
    }
    if (profile.status === UserStatus.DEACTIVATED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'account deactivated',
      });
    }
    return this.startSession(res, profile);
  }

  /**
   * ACC-04, ACC-11, ACC-19: the logged-in user's profile, for GET /auth/me and /users/me.
   * The guard has just loaded the user, but it can be deleted between the guard and this
   * call; that is the same 401 as a missing session, never a 500.
   */
  async currentProfile(userId: string): Promise<UserProfile> {
    const profile = await this.users.findById(userId);
    if (!profile) {
      throw unauthenticated();
    }
    return profile;
  }

  /**
   * ACC-06: exchanges the refresh_token cookie for a new access token and a new refresh
   * token, in the same session. Reads nothing but that cookie.
   *
   * The refresh token is rotated first, in one atomic update (SessionsService.rotate), so
   * the old one stops working at once and of two concurrent refreshes exactly one succeeds.
   * Then the user must still exist and be ACTIVE; otherwise the session is revoked. Every
   * failure gives the same 401 UNAUTHENTICATED and clears both cookies, so the response
   * does not reveal why. Neither token ever goes into the body or a log. The login lockout
   * (ACC-05) is not involved: no password is checked here.
   */
  async refresh(request: Request, res: Response): Promise<UserProfile> {
    const rotated = await this.sessions.rotate(refreshTokenCookie(request));
    if (!rotated) {
      throw this.endSessionCookies(res);
    }

    const profile = await this.users.findById(rotated.userId);
    if (!profile || profile.status !== UserStatus.ACTIVE) {
      await this.sessions.revoke(rotated.sessionId);
      throw this.endSessionCookies(res);
    }

    const token = await this.accessTokens.sign(profile.id, rotated.sessionId);
    setAccessTokenCookie(res, token);
    setRefreshTokenCookie(res, rotated.refreshToken, rotated.expiresAt);
    return profile;
  }

  // A failed refresh: clears both cookies (they are useless now) and returns the generic
  // 401 for the caller to throw.
  private endSessionCookies(res: Response): UnauthorizedException {
    clearAccessTokenCookie(res);
    clearRefreshTokenCookie(res);
    return unauthenticated();
  }

  /**
   * The only place that starts a session (ACC-04, ACC-06, ACC-19): creates the session,
   * signs the access token for the user and the session, and sets both httpOnly cookies
   * (access_token, and refresh_token limited to /api/auth). Login and register call it only
   * after every check has passed. The refresh token goes only into its cookie: never into
   * the response body or a log.
   */
  async startSession(
    res: Response,
    profile: UserProfile,
  ): Promise<UserProfile> {
    const session = await this.sessions.create(profile.id);
    const token = await this.accessTokens.sign(profile.id, session.sessionId);
    setAccessTokenCookie(res, token);
    setRefreshTokenCookie(res, session.refreshToken, session.expiresAt);
    return profile;
  }
}
