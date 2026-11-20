// FLT-29: the passenger list as CSV (RFC 4180: comma separated, CRLF line ends, a cell with
// a comma, quote or line break is quoted and its quotes doubled). A cell that starts with
// = + - @ or a control character would run as a formula when the file is opened in a
// spreadsheet (CSV injection), so it gets a leading apostrophe. A passenger name is typed
// by the buyer of the booking, so it is never trusted.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// The BOM makes Excel read the file as UTF-8, so Arabic names stay intact.
const UTF8_BOM = '﻿';

export function toCsv(header: readonly string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
