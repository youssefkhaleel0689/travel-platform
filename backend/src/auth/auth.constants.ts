// Shared authentication settings (schema section 7 "Configuration values").
// Values that the requirements fix are constants, not environment variables,
// so every module reads the same number.

/** ACC-01, ACC-08: at least 8 characters with at least one letter and one digit. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;
export const PASSWORD_RULE_MESSAGE =
  'password must be at least 8 characters and contain at least one letter and one digit';

/** ACC-05: 5 consecutive failed logins lock the account for 15 minutes. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/** ACC-06: a session with no authenticated request for 30 minutes expires. */
export const SESSION_INACTIVITY_MINUTES = 30;

/** Access token lifetime. Shorter than the inactivity window on purpose. */
export const ACCESS_TOKEN_MINUTES = 15;

/** Absolute refresh-token lifetime; inactivity usually ends a session first. */
export const REFRESH_TOKEN_DAYS = 7;

/**
 * ACC-19: tokens travel only in httpOnly cookies, never in a response body and
 * never in JavaScript-accessible storage.
 */
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Version of the terms a registration accepts (ACC-01). */
export const CURRENT_TERMS_VERSION = '1.0';

/** bcrypt work factor used for password and temporary-password hashes. */
export const BCRYPT_ROUNDS = 12;
