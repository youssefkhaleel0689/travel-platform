import { BadRequestException } from '@nestjs/common';
import {
  toAirportLocalDateKey,
  toAirportLocalIso,
  toUtcFromAirportLocal,
} from './airport-time';

// Returns the response body of the BadRequestException thrown by run.
function badRequestBody(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    if (error instanceof BadRequestException) {
      return error.getResponse();
    }
    throw error;
  }
  throw new Error('Expected a BadRequestException');
}

describe('toUtcFromAirportLocal', () => {
  it.each([
    [
      'Cairo in winter (UTC+2)',
      '2026-11-20T08:30',
      'Africa/Cairo',
      '2026-11-20T06:30:00.000Z',
    ],
    [
      'Cairo in summer (UTC+3)',
      '2026-07-20T08:30',
      'Africa/Cairo',
      '2026-07-20T05:30:00.000Z',
    ],
    [
      'Tokyo, into the previous UTC day',
      '2026-11-20T08:30',
      'Asia/Tokyo',
      '2026-11-19T23:30:00.000Z',
    ],
    [
      'Cairo at local midnight',
      '2026-11-20T00:00',
      'Africa/Cairo',
      '2026-11-19T22:00:00.000Z',
    ],
    [
      'New York, into the next UTC day',
      '2026-11-20T20:00',
      'America/New_York',
      '2026-11-21T01:00:00.000Z',
    ],
  ])('converts %s', (_case, local, timeZone, utc) => {
    expect(toUtcFromAirportLocal(local, timeZone).toISOString()).toBe(utc);
  });

  describe('DST gap: the clocks skip an hour', () => {
    it.each([
      ['Cairo on 24 April', '2026-04-24T00:30', 'Africa/Cairo'],
      ['London on 29 March', '2026-03-29T01:30', 'Europe/London'],
    ])('rejects a time in the gap (%s)', (_case, local, timeZone) => {
      expect(
        badRequestBody(() => toUtcFromAirportLocal(local, timeZone)),
      ).toEqual({
        code: 'NONEXISTENT_LOCAL_TIME',
        message: `${local} does not exist in ${timeZone} (clocks move forward)`,
        errors: [
          {
            field: 'localDateTime',
            messages: [
              `${local} does not exist in ${timeZone} (clocks move forward)`,
            ],
          },
        ],
      });
    });

    it('accepts the last minute before and the first minute after the Cairo gap', () => {
      expect(
        toUtcFromAirportLocal('2026-04-23T23:59', 'Africa/Cairo').toISOString(),
      ).toBe('2026-04-23T21:59:00.000Z');
      expect(
        toUtcFromAirportLocal('2026-04-24T01:00', 'Africa/Cairo').toISOString(),
      ).toBe('2026-04-23T22:00:00.000Z');
    });
  });

  describe('DST overlap: the clocks repeat an hour', () => {
    it.each([
      // The later instants would be 21:30Z and 06:30Z.
      [
        'Cairo on 29 October',
        '2026-10-29T23:30',
        'Africa/Cairo',
        '2026-10-29T20:30:00.000Z',
      ],
      [
        'New York on 1 November',
        '2026-11-01T01:30',
        'America/New_York',
        '2026-11-01T05:30:00.000Z',
      ],
    ])('chooses the earlier instant (%s)', (_case, local, timeZone, utc) => {
      expect(toUtcFromAirportLocal(local, timeZone).toISOString()).toBe(utc);
    });
  });

  it('names the given field in the error', () => {
    const body = badRequestBody(() =>
      toUtcFromAirportLocal(
        '2026-04-24T00:30',
        'Africa/Cairo',
        'departureLocal',
      ),
    );
    expect(body).toMatchObject({ errors: [{ field: 'departureLocal' }] });
  });

  it.each(['2026-02-30T08:30', '2026-11-20', '2026-11-20T08:30Z'])(
    'rejects %s with INVALID_LOCAL_DATE_TIME',
    (local) => {
      expect(
        badRequestBody(() => toUtcFromAirportLocal(local, 'Africa/Cairo')),
      ).toMatchObject({
        code: 'INVALID_LOCAL_DATE_TIME',
        errors: [{ field: 'localDateTime' }],
      });
    },
  );

  it('throws a RangeError for an unknown time zone', () => {
    expect(() =>
      toUtcFromAirportLocal('2026-11-20T08:30', 'Mars/Olympus'),
    ).toThrow(RangeError);
  });
});

describe('toAirportLocalDateKey', () => {
  it.each([
    [
      'Cairo, one second before local midnight',
      '2026-11-19T21:59:59Z',
      'Africa/Cairo',
      '2026-11-19',
    ],
    [
      'Cairo, at local midnight',
      '2026-11-19T22:00:00Z',
      'Africa/Cairo',
      '2026-11-20',
    ],
    [
      'Cairo in summer, at local midnight',
      '2026-07-19T21:00:00Z',
      'Africa/Cairo',
      '2026-07-20',
    ],
    [
      'Tokyo, one minute before local midnight',
      '2026-11-19T14:59:00Z',
      'Asia/Tokyo',
      '2026-11-19',
    ],
    [
      'Tokyo, at local midnight',
      '2026-11-19T15:00:00Z',
      'Asia/Tokyo',
      '2026-11-20',
    ],
    [
      'New York, before local midnight on the next UTC day',
      '2026-11-21T04:59:00Z',
      'America/New_York',
      '2026-11-20',
    ],
    [
      'New York, at local midnight',
      '2026-11-21T05:00:00Z',
      'America/New_York',
      '2026-11-21',
    ],
  ])('%s', (_case, utc, timeZone, key) => {
    expect(toAirportLocalDateKey(new Date(utc), timeZone)).toBe(key);
  });
});

describe('toAirportLocalIso', () => {
  it.each([
    [
      'Cairo in winter',
      '2026-11-20T06:30:00Z',
      'Africa/Cairo',
      '2026-11-20T08:30:00+02:00',
    ],
    [
      'Cairo in summer',
      '2026-07-20T05:30:00Z',
      'Africa/Cairo',
      '2026-07-20T08:30:00+03:00',
    ],
    [
      'London in winter',
      '2026-01-10T12:00:00Z',
      'Europe/London',
      '2026-01-10T12:00:00+00:00',
    ],
    [
      'London in summer',
      '2026-07-10T12:00:00Z',
      'Europe/London',
      '2026-07-10T13:00:00+01:00',
    ],
    [
      'New York in winter',
      '2026-11-20T13:00:00Z',
      'America/New_York',
      '2026-11-20T08:00:00-05:00',
    ],
    [
      'New York in summer',
      '2026-07-10T12:00:00Z',
      'America/New_York',
      '2026-07-10T08:00:00-04:00',
    ],
    [
      'a half-hour offset (Kolkata)',
      '2026-11-20T03:00:00Z',
      'Asia/Kolkata',
      '2026-11-20T08:30:00+05:30',
    ],
  ])('formats %s', (_case, utc, timeZone, iso) => {
    expect(toAirportLocalIso(new Date(utc), timeZone)).toBe(iso);
  });

  it('keeps seconds and drops milliseconds', () => {
    const instant = new Date('2026-11-20T06:30:45.678Z');
    expect(toAirportLocalIso(instant, 'Africa/Cairo')).toBe(
      '2026-11-20T08:30:45+02:00',
    );
  });

  it('names the same instant, so it can be parsed back', () => {
    const instant = new Date('2026-11-19T23:30:00Z');
    const iso = toAirportLocalIso(instant, 'Asia/Tokyo');
    expect(iso).toBe('2026-11-20T08:30:00+09:00');
    expect(new Date(iso).getTime()).toBe(instant.getTime());
  });

  it('shows which instant an overlap resolved to', () => {
    const instant = toUtcFromAirportLocal('2026-10-29T23:30', 'Africa/Cairo');
    expect(toAirportLocalIso(instant, 'Africa/Cairo')).toBe(
      '2026-10-29T23:30:00+03:00',
    );
  });

  it('throws a RangeError for an invalid Date', () => {
    expect(() =>
      toAirportLocalIso(new Date('not a date'), 'Africa/Cairo'),
    ).toThrow(RangeError);
  });
});
