// Airport-local dates and times as a client sends them, without an offset (GEN-06).
// The time zone never comes from the input: it is the airport's IANA timeZone.

// A calendar date, e.g. 2026-11-20.
export const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A date and a time to the minute, e.g. 2026-11-20T08:30. No seconds, no Z, no offset.
export const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export interface LocalDateTimeParts {
  year: number;
  month: number; // 1 to 12
  day: number;
  hour: number; // 0 to 23
  minute: number;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Gregorian rule, computed by hand because Date treats years 0 to 99 as 1900 to 1999.
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

// The regex only checks the shape; this checks that the values exist on a calendar and a clock.
function toParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): LocalDateTimeParts | null {
  if (month < 1 || month > 12) {
    return null;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  if (hour > 23 || minute > 59) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/** Parses "YYYY-MM-DD". Returns null for any other shape or a date that does not exist. */
export function parseLocalDate(value: unknown): LocalDateTimeParts | null {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  return toParts(year, month, day, 0, 0);
}

/** Parses "YYYY-MM-DDTHH:mm". Returns null for any other shape or a value that does not exist. */
export function parseLocalDateTime(value: unknown): LocalDateTimeParts | null {
  if (typeof value !== 'string' || !LOCAL_DATE_TIME.test(value)) {
    return null;
  }
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return toParts(year, month, day, hour, minute);
}
