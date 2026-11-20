import { fieldBadRequest } from './validation/field-error';

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parses a strict 'YYYY-MM-DD' UTC date. Impossible dates such as 2027-02-30
 * are rejected instead of being silently rolled into the next month.
 */
export function parseDateOnly(value: string, field = 'date'): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw fieldBadRequest(field, `${field} must use YYYY-MM-DD`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw fieldBadRequest(field, `${field} must be a real calendar date`);
  }
  return d;
}

export function todayUtc(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Validates a stay (HTL-11 / HTL-18): check-out after check-in, check-in not in the past. */
export function parseStay(checkInDate: string, checkOutDate: string) {
  const checkIn = parseDateOnly(checkInDate, 'checkInDate');
  const checkOut = parseDateOnly(checkOutDate, 'checkOutDate');
  if (checkOut <= checkIn) {
    throw fieldBadRequest(
      'checkOutDate',
      'checkOutDate must be after checkInDate',
    );
  }
  if (checkIn < todayUtc()) {
    throw fieldBadRequest('checkInDate', 'checkInDate cannot be in the past');
  }
  return { checkIn, checkOut, nights: nightsBetween(checkIn, checkOut) };
}

export const toDateKey = (d: Date) => d.toISOString().slice(0, 10);
