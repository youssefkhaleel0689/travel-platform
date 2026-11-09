import { parseLocalDate, parseLocalDateTime } from './local-date-time';

describe('parseLocalDate', () => {
  it('returns the parts of a valid date with midnight as the time', () => {
    expect(parseLocalDate('2026-11-20')).toEqual({
      year: 2026,
      month: 11,
      day: 20,
      hour: 0,
      minute: 0,
    });
  });

  it.each(['2028-02-29', '2000-02-29', '2026-01-31', '2026-12-31'])(
    'accepts %s',
    (value) => {
      expect(parseLocalDate(value)).not.toBeNull();
    },
  );

  it.each([
    ['a day that does not exist', '2026-02-30'],
    ['29 February in a common year', '2027-02-29'],
    ['29 February in a century that is not a leap year', '2100-02-29'],
    ['31 April', '2026-04-31'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-11-00'],
  ])('rejects %s (%s)', (_reason, value) => {
    expect(parseLocalDate(value)).toBeNull();
  });

  it.each([
    ['missing leading zeros', '2026-1-5'],
    ['no separators', '20261120'],
    ['surrounding spaces', ' 2026-11-20 '],
    ['a time', '2026-11-20T08:30'],
    ['an empty string', ''],
  ])('rejects %s', (_reason, value) => {
    expect(parseLocalDate(value)).toBeNull();
  });

  it.each([
    ['a number', 20261120],
    ['null', null],
    ['an array', ['2026-11-20']],
  ])('rejects %s instead of converting it to text', (_reason, value) => {
    expect(parseLocalDate(value)).toBeNull();
  });
});

describe('parseLocalDateTime', () => {
  it('returns the parts of a valid date and time', () => {
    expect(parseLocalDateTime('2026-11-20T08:30')).toEqual({
      year: 2026,
      month: 11,
      day: 20,
      hour: 8,
      minute: 30,
    });
  });

  it.each(['2026-11-20T00:00', '2026-11-20T23:59', '2028-02-29T12:00'])(
    'accepts %s',
    (value) => {
      expect(parseLocalDateTime(value)).not.toBeNull();
    },
  );

  it.each([
    ['hour 24', '2026-11-20T24:00'],
    ['minute 60', '2026-11-20T08:60'],
    ['a date that does not exist', '2026-02-30T08:30'],
  ])('rejects %s (%s)', (_reason, value) => {
    expect(parseLocalDateTime(value)).toBeNull();
  });

  it.each([
    ['seconds', '2026-11-20T08:30:00'],
    ['a Z suffix', '2026-11-20T08:30Z'],
    ['an offset', '2026-11-20T08:30+02:00'],
    ['a space instead of T', '2026-11-20 08:30'],
    ['a lowercase t', '2026-11-20t08:30'],
    ['a date only', '2026-11-20'],
  ])('rejects %s', (_reason, value) => {
    expect(parseLocalDateTime(value)).toBeNull();
  });

  it('rejects a value that is not a string', () => {
    expect(parseLocalDateTime(undefined)).toBeNull();
  });
});
