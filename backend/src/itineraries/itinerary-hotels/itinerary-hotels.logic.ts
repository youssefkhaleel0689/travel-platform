import { dateOfDay } from '../itinerary-days.logic';

/**
 * ITN-25: the check-out date for a city group, the day after its last day. Works on
 * YYYY-MM-DD strings read as UTC midnight, so the local time zone never moves the date.
 */
export function dayAfter(date: string): string {
  return dateOfDay(new Date(`${date}T00:00:00.000Z`), 1);
}
