// Shared by flight search (FLT-11, FLT-12) and, later, the hold (FLT-22), so a party that
// can be searched for can also be booked.

// Most airlines take at most 9 seated passengers in one booking; larger groups book
// separately. Infants sit on a lap and are not counted (FLT-12).
export const MAX_SEATED_PASSENGERS = 9;

// A price in the platform currency as a query value: up to 10 digits and 2 decimals.
export const MONEY_AMOUNT = /^\d{1,10}(?:\.\d{1,2})?$/;

// TODO(FLT-22): import TripType from schemas/flight-booking.schema once PR #20 is merged.
export enum TripType {
  ONE_WAY = 'ONE_WAY',
  ROUND_TRIP = 'ROUND_TRIP',
}

export enum FlightSortBy {
  PRICE = 'price',
  DURATION = 'duration',
  DEPARTURE_TIME = 'departureTime',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}
