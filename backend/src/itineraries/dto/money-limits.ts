// Sanity ceiling for one itinerary amount, so a typo cannot store an absurd
// value (e.g. 1e15). Not a business rule; JPY amounts are the largest.
export const MAX_ITINERARY_AMOUNT = 100_000_000;
