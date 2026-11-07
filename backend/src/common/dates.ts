import { BadRequestException } from '@nestjs/common';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses 'YYYY-MM-DD' (or any ISO string) into a UTC-midnight date-only value. */
export function parseDateOnly(value: string, field = 'date'): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} is not a valid date`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
  if (checkOut <= checkIn) throw new BadRequestException('checkOutDate must be after checkInDate');
  if (checkIn < todayUtc()) throw new BadRequestException('checkInDate cannot be in the past');
  return { checkIn, checkOut, nights: nightsBetween(checkIn, checkOut) };
}

export const toDateKey = (d: Date) => d.toISOString().slice(0, 10);
