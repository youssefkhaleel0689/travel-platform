import { BadRequestException } from '@nestjs/common';
import { FieldErrorDto } from '../dto/error-response.dto';
import { LocalDateTimeParts, parseLocalDateTime } from './local-date-time';

// Converts between UTC instants and the wall-clock time at an airport (GEN-06), using
// the built-in Intl API. Flights are stored in UTC; the zone is the airport's IANA timeZone.

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

interface WallClock extends LocalDateTimeParts {
  second: number;
}

// Creating a formatter is slow, so each time zone gets one and reuses it.
const formatters = new Map<string, Intl.DateTimeFormat>();

// Intl throws a RangeError for an unknown zone. Zones come from the validated seed,
// so that is a data bug and becomes a 500, not a 400.
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

// What the airport's clock shows at an instant.
function wallClockAt(instant: Date, timeZone: string): WallClock {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }
  const { year, month, day, hour, minute, second } = values;
  return { year, month, day, hour, minute, second };
}

// The wall-clock time read as if it were UTC, in milliseconds.
// setUTCFullYear is used because Date.UTC reads years 0 to 99 as 1900 to 1999.
function wallClockAsUtcMs(wall: WallClock): number {
  const date = new Date(0);
  date.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  date.setUTCHours(wall.hour, wall.minute, wall.second, 0);
  return date.getTime();
}

// How many minutes the airport's clock is ahead of UTC at an instant (Cairo in winter: 120).
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const wallMs = wallClockAsUtcMs(wallClockAt(instant, timeZone));
  const instantMs = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((wallMs - instantMs) / MINUTE_MS);
}

function sameMinute(a: LocalDateTimeParts, b: LocalDateTimeParts): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

function fieldError(
  code: string,
  field: string,
  message: string,
): BadRequestException {
  const errors: FieldErrorDto[] = [{ field, messages: [message] }];
  return new BadRequestException({ code, message, errors });
}

/**
 * Converts an airport-local "YYYY-MM-DDTHH:mm" to the UTC instant it names.
 * A time skipped by a DST change is rejected with 400 NONEXISTENT_LOCAL_TIME; a time
 * that happens twice resolves to the earlier instant. `field` names the request field.
 */
export function toUtcFromAirportLocal(
  localDateTime: string,
  timeZone: string,
  field = 'localDateTime',
): Date {
  const local = parseLocalDateTime(localDateTime);
  if (!local) {
    throw fieldError(
      'INVALID_LOCAL_DATE_TIME',
      field,
      `${field} must be a valid local date and time (YYYY-MM-DDTHH:mm)`,
    );
  }

  // 1. Read the wall-clock time as if it were UTC.
  const wallMs = wallClockAsUtcMs({ ...local, second: 0 });

  // 2. A DST change happens at most once around a given day, so the offsets one day
  //    before and one day after are the only ones this time can have.
  const offsets = new Set([
    offsetMinutesAt(new Date(wallMs - DAY_MS), timeZone),
    offsetMinutesAt(new Date(wallMs + DAY_MS), timeZone),
  ]);

  // 3. Keep each candidate instant that shows the requested time on the airport's clock.
  const matches = [...offsets]
    .map((offset) => wallMs - offset * MINUTE_MS)
    .filter((ms) => sameMinute(wallClockAt(new Date(ms), timeZone), local))
    .sort((a, b) => a - b);

  // 4. No match: the clocks skipped this time. Two matches: it happened twice; keep the earlier.
  if (matches.length === 0) {
    throw fieldError(
      'NONEXISTENT_LOCAL_TIME',
      field,
      `${localDateTime} does not exist in ${timeZone} (clocks move forward)`,
    );
  }
  return new Date(matches[0]);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

// 120 -> "+02:00", -240 -> "-04:00", 330 -> "+05:30".
function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function formatDate(wall: WallClock): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The airport's local calendar date at an instant, as "YYYY-MM-DD" (departureDateKey). */
export function toAirportLocalDateKey(instant: Date, timeZone: string): string {
  return formatDate(wallClockAt(instant, timeZone));
}

/**
 * The instant in ISO 8601 as the airport's clock shows it, with the offset in effect,
 * e.g. "2026-11-20T08:30:00+02:00". Milliseconds are dropped.
 */
export function toAirportLocalIso(instant: Date, timeZone: string): string {
  const wall = wallClockAt(instant, timeZone);
  const time = `${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`;
  const offset = formatOffset(offsetMinutesAt(instant, timeZone));
  return `${formatDate(wall)}T${time}${offset}`;
}
