// Schema section 6 "Enums": Guest is anonymous and is never stored.
export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
  AIRLINE_MODERATOR = 'AIRLINE_MODERATOR',
  HOTEL_MODERATOR = 'HOTEL_MODERATOR',
}

export const ROLES = Object.values(Role);

/** The two provider roles, each tied to exactly one airline or hotel. */
export const MODERATOR_ROLES: Role[] = [
  Role.AIRLINE_MODERATOR,
  Role.HOTEL_MODERATOR,
];
