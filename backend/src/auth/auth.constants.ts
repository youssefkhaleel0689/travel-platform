// Name of the httpOnly cookie that carries the access token (ACC-19).
// Must match .addCookieAuth('access_token') in main.ts, or Swagger sends the wrong cookie.
export const ACCESS_TOKEN_COOKIE = 'access_token';

// 30 minutes. Refresh tokens arrive in PR 4 (ACC-06).
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;
