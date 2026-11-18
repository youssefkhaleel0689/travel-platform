// Name of the httpOnly cookie that carries the access token (ACC-19).
// Must match .addCookieAuth('access_token') in main.ts, or Swagger sends the wrong cookie.
export const ACCESS_TOKEN_COOKIE = 'access_token';

// 30 minutes. A refresh token (ACC-06) gets a new one without logging in again.
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;

// Name of the httpOnly cookie that carries the refresh token (ACC-06).
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

// The refresh token is only sent to the auth endpoints (refresh and logout), never to the
// rest of the API.
export const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';
