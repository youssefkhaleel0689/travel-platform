// Shared by flight search (FLT-11, FLT-12) and, later, the hold (FLT-22), so a party that
// can be searched for can also be booked.

// Most airlines take at most 9 seated passengers in one booking; larger groups book
// separately. Infants sit on a lap and are not counted (FLT-12).
export const MAX_SEATED_PASSENGERS = 9;

// A price in the platform currency as a query value: up to 10 digits and 2 decimals.
export const MONEY_AMOUNT = /^\d{1,10}(?:\.\d{1,2})?$/;

// One definition for search and bookings, so a searched trip type can be stored as is.
export { TripType } from '../schemas/flight-booking.schema';

export enum FlightSortBy {
  PRICE = 'price',
  DURATION = 'duration',
  DEPARTURE_TIME = 'departureTime',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}
