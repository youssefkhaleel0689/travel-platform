// Names of models owned by OTHER parts of the platform (B1 / C2 / shared seed data).
// B2 reads them through the Mongoose connection, so no schema is duplicated here.
export const EXTERNAL_MODELS = {
  HOTEL: 'Hotel',
  HOTEL_MODERATOR_ASSIGNMENT: 'HotelModeratorAssignment',
  USER: 'User',
  CITY: 'City',
  COUNTRY: 'Country',
} as const;

export const HOLD_MINUTES = 10;
export const MAX_STATUS_VIEW_NIGHTS = 366;
export const PLATFORM_CURRENCY = process.env.PLATFORM_CURRENCY || 'USD';

export const DEFAULT_CHECK_IN_TIME = '14:00';
export const DEFAULT_CHECK_OUT_TIME = '12:00';

export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
  AIRLINE_MODERATOR = 'AIRLINE_MODERATOR',
  HOTEL_MODERATOR = 'HOTEL_MODERATOR',
}
