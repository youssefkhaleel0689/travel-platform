import { BadRequestException } from '@nestjs/common';
import { toUtcFromAirportLocal } from './airport-time';

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
