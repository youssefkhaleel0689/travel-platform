// ACC-05: after 5 consecutive failed logins the account is locked for 15 minutes.
// Fixed by the requirement, so not configurable through .env.
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
