// Schema section 6 "Enums": users.status.
export enum UserStatus {
  /** Can log in and use the platform. */
  ACTIVE = 'ACTIVE',
  /** Suspended by an admin (ACC-15, ACC-16); cannot log in, bookings stay valid. */
  SUSPENDED = 'SUSPENDED',
  /** Deactivated by the user (ACC-12); cannot log in, content is hidden. */
  DEACTIVATED = 'DEACTIVATED',
}

export const USER_STATUSES = Object.values(UserStatus);
