import type { CookieOptions, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
} from '../auth.constants';

/**
 * The access token cookie (ACC-19): httpOnly so page scripts cannot read it, secure so it
 * is only sent over HTTPS (browsers treat http://localhost as secure), sameSite lax against
 * cross-site form posts.
 *
 * A browser only clears a cookie when the name and path match the ones it was set with, so
 * setting and clearing both use these options.
 */
export const ACCESS_TOKEN_COOKIE_OPTIONS: Readonly<CookieOptions> =
  Object.freeze({
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });

export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...ACCESS_TOKEN_COOKIE_OPTIONS,
    // Express uses milliseconds here; the cookie lives as long as the token.
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAccessTokenCookie(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...ACCESS_TOKEN_COOKIE_OPTIONS });
}
