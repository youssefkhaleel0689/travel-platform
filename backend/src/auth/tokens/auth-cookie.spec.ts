import type { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../auth.constants';
import {
  ACCESS_TOKEN_COOKIE_OPTIONS,
  clearAccessTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE_OPTIONS,
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from './auth-cookie';

// Only what the helpers use; the cast is done only here.
function stubResponse() {
  const res = {
    cookie: jest.fn(
      (_name: string, _value: string, _options: CookieOptions) => undefined,
    ),
    clearCookie: jest.fn((_name: string, _options: CookieOptions) => undefined),
  };
  return { res, response: res as unknown as Response };
}

describe('access token cookie (ACC-19)', () => {
  it('has the agreed options', () => {
    expect(ACCESS_TOKEN_COOKIE).toBe('access_token');
    expect(ACCESS_TOKEN_COOKIE_OPTIONS).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('sets the token with those options and a 30-minute maxAge in milliseconds', () => {
    const { res, response } = stubResponse();
    setAccessTokenCookie(response, 'signed.jwt.token');

    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'signed.jwt.token',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1_800_000,
      },
    );
  });

  it('clears with the same name, path and flags and no maxAge', () => {
    const { res, response } = stubResponse();
    clearAccessTokenCookie(response);

    expect(res.clearCookie).toHaveBeenCalledTimes(1);
    const [name, options] = res.clearCookie.mock.calls[0];
    expect(name).toBe('access_token');
    expect(options).toEqual(ACCESS_TOKEN_COOKIE_OPTIONS);
    expect(options).not.toHaveProperty('maxAge');
  });

  it('does not let a caller change the shared options', () => {
    expect(Object.isFrozen(ACCESS_TOKEN_COOKIE_OPTIONS)).toBe(true);
  });
});

describe('refresh token cookie (ACC-06)', () => {
  const NOW = Date.parse('2026-11-17T10:00:00.000Z');

  it('has the agreed options: the access cookie flags, path /api/auth', () => {
    expect(REFRESH_TOKEN_COOKIE).toBe('refresh_token');
    expect(REFRESH_TOKEN_COOKIE_OPTIONS).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/auth',
    });
    expect(Object.isFrozen(REFRESH_TOKEN_COOKIE_OPTIONS)).toBe(true);
  });

  it('lives until the session ends, in whole seconds', () => {
    const { res, response } = stubResponse();
    // 5 hours and 0.9 seconds ahead: rounded down, so the cookie never outlives the session.
    const expiresAt = new Date(NOW + 5 * 60 * 60 * 1000 + 900);
    setRefreshTokenCookie(response, 'refresh-token-value', expiresAt, NOW);

    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token-value',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 5 * 60 * 60 * 1000,
      },
    );
  });

  it('never gets a negative maxAge for a session already past its end', () => {
    const { res, response } = stubResponse();
    setRefreshTokenCookie(
      response,
      'refresh-token-value',
      new Date(NOW - 5000),
      NOW,
    );
    expect(res.cookie.mock.calls[0][2].maxAge).toBe(0);
  });

  it('clears with the same name, path and flags and no maxAge', () => {
    const { res, response } = stubResponse();
    clearRefreshTokenCookie(response);

    expect(res.clearCookie).toHaveBeenCalledTimes(1);
    const [name, options] = res.clearCookie.mock.calls[0];
    expect(name).toBe('refresh_token');
    expect(options).toEqual(REFRESH_TOKEN_COOKIE_OPTIONS);
    expect(options).not.toHaveProperty('maxAge');
  });
});
