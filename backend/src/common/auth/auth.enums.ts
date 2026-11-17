// Shared by every module (guards, role checks, admin filters), so it lives in common
// and has no dependency on the auth module.
export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
  AIRLINE_MODERATOR = 'AIRLINE_MODERATOR',
  HOTEL_MODERATOR = 'HOTEL_MODERATOR',
}

// SUSPENDED is set by an admin (ACC-15/16), DEACTIVATED by the user (ACC-12).
// Login accepts only ACTIVE.
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}
