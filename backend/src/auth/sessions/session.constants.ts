// ACC-06: a session ends after 30 minutes without activity (idle expiry).
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Absolute cap decided by the team: a session ends 5 hours after login, however active it
// is, so a stolen refresh token cannot be kept alive forever.
export const SESSION_ABSOLUTE_LIFETIME_MS = 5 * 60 * 60 * 1000;

// lastActivityAt is written at most once a minute, not on every request, to spare the
// database a write per request. The idle expiry is therefore exact to within a minute.
export const SESSION_ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;

// 32 random bytes (256 bits) per refresh token: 43 characters in base64url.
export const REFRESH_TOKEN_BYTES = 32;
