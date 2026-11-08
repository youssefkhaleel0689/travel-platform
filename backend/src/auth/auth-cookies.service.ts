import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MINUTES,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_DAYS,
} from './auth.constants';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * ACC-19: both tokens are issued as httpOnly, Secure, SameSite cookies, so no
 * JavaScript on the page can read them and nothing is kept in localStorage or
 * sessionStorage. The frontend learns who is logged in from GET /api/auth/me.
 *
 * Secure is off in development only, because a cookie marked Secure is not
 * sent over plain http://localhost and Swagger UI could not be used at all.
 */
@Injectable()
export class AuthCookiesService {
  constructor(private readonly config: ConfigService) {}

  private baseOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
    };
  }

  /** Called by login (ACC-04) and by refresh. */
  setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const options = this.baseOptions();
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...options,
      maxAge: ACCESS_TOKEN_MINUTES * MINUTE_MS,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...options,
      maxAge: REFRESH_TOKEN_DAYS * DAY_MS,
    });
  }

  /** ACC-06: logout clears both cookies; the session is revoked separately. */
  clearAuthCookies(res: Response) {
    const options = this.baseOptions();
    res.clearCookie(ACCESS_TOKEN_COOKIE, options);
    res.clearCookie(REFRESH_TOKEN_COOKIE, options);
  }
}
