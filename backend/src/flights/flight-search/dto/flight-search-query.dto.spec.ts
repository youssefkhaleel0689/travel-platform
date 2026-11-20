import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../../common/validation/validation-exception.factory';
import { CabinCategory } from '../../schemas/flight.schema';
import { FlightSortBy, SortOrder, TripType } from '../flight-search.constants';
import { FlightSearchQueryDto } from './flight-search-query.dto';

// Same options as configureApp in src/app.setup.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

// Query values always arrive as strings.
const BASE = {
  departureAirportId: 'CAI',
  arrivalAirportId: 'DXB',
  departureDate: '2026-12-20',
};

function transform(
  query: Record<string, string>,
): Promise<FlightSearchQueryDto> {
  return pipe.transform(query, {
    type: 'query',
    metatype: FlightSearchQueryDto,
  }) as Promise<FlightSearchQueryDto>;
}

// The field errors of a rejected query, in the GEN-02 { field, messages } shape.
async function fieldErrors(
  query: Record<string, string>,
): Promise<{ field: string; messages: string[] }[]> {
  try {
    await transform(query);
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (
        error.getResponse() as {
          errors: { field: string; messages: string[] }[];
        }
      ).errors;
    }
    throw error;
  }
  return [];
}

async function failedFields(query: Record<string, string>): Promise<string[]> {
  return (await fieldErrors(query)).map((e) => e.field);
}

describe('FlightSearchQueryDto (FLT-11, FLT-12, FLT-15)', () => {
  describe('valid queries', () => {
    it('fills in the defaults for a minimal one-way search', async () => {
      const query = await transform(BASE);
      expect(query).toMatchObject({
        ...BASE,
        tripType: TripType.ONE_WAY,
        adults: 1,
        children: 0,
        infants: 0,
        sortBy: FlightSortBy.PRICE,
        sortOrder: SortOrder.ASC,
        page: 1,
        returnPage: 1,
      });
      expect(query.returnDate).toBeUndefined();
    });

    it('upper-cases codes, the trip type and the cabin, and turns counts into numbers', async () => {
      const query = await transform({
        departureAirportId: ' cai ',
        arrivalAirportId: 'dxb',
        departureDate: '2026-12-20',
        tripType: 'round_trip',
        returnDate: '2026-12-27',
        adults: '2',
        children: '1',
        infants: '2',
        cabin: 'economy',
        returnPage: '3',
      });
      expect(query).toMatchObject({
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        tripType: TripType.ROUND_TRIP,
        returnDate: '2026-12-27',
        adults: 2,
        children: 1,
        infants: 2,
        cabin: CabinCategory.ECONOMY,
        returnPage: 3,
      });
    });

    it.each([
      [
        'a return on the same day',
        { tripType: 'ROUND_TRIP', returnDate: '2026-12-20' },
      ],
      ['the seat limit exactly', { adults: '5', children: '4' }],
      ['as many infants as adults', { adults: '2', infants: '2' }],
      ['an equal price range', { minPrice: '199.99', maxPrice: '199.99' }],
      ['whole and decimal amounts', { minPrice: '99.99', maxPrice: '100' }],
      [
        'sorting by duration, descending',
        { sortBy: 'duration', sortOrder: 'desc' },
      ],
    ])('accepts %s', async (_case, extra) => {
      await expect(failedFields({ ...BASE, ...extra })).resolves.toEqual([]);
    });
  });

  describe('single fields', () => {
    it('requires the airports and the departure date', async () => {
      await expect(failedFields({})).resolves.toEqual([
        'departureAirportId',
        'arrivalAirportId',
        'departureDate',
      ]);
    });

    it.each([
      [
        'an airport that is not an IATA code',
        { departureAirportId: 'CAIRO' },
        'departureAirportId',
      ],
      [
        'a date that does not exist',
        { departureDate: '2026-02-30' },
        'departureDate',
      ],
      [
        'a date with a time',
        { departureDate: '2026-12-20T08:00' },
        'departureDate',
      ],
      ['an unknown trip type', { tripType: 'MULTI_CITY' }, 'tripType'],
      ['no adult', { adults: '0' }, 'adults'],
      ['more than 9 adults', { adults: '10' }, 'adults'],
      ['a fraction of a passenger', { adults: '1.5' }, 'adults'],
      ['negative children', { children: '-1' }, 'children'],
      ['an unknown cabin', { cabin: 'COACH' }, 'cabin'],
      ['a negative price', { minPrice: '-1' }, 'minPrice'],
      ['a price with 3 decimals', { maxPrice: '1.999' }, 'maxPrice'],
      ['an unknown sort field', { sortBy: 'cheapest' }, 'sortBy'],
      ['an unknown sort order', { sortOrder: 'up' }, 'sortOrder'],
      ['return page 0', { returnPage: '0' }, 'returnPage'],
    ])('rejects %s', async (_case, extra, field) => {
      await expect(failedFields({ ...BASE, ...extra })).resolves.toEqual([
        field,
      ]);
    });

    it('rejects an unknown query parameter', async () => {
      await expect(failedFields({ ...BASE, limit: '50' })).resolves.toEqual([
        'limit',
      ]);
    });
  });

  describe('rules between fields', () => {
    it.each([
      [
        'the same airport twice',
        { arrivalAirportId: 'CAI' },
        'arrivalAirportId',
        'arrivalAirportId must differ from departureAirportId',
      ],
      [
        'more infants than adults',
        { adults: '1', infants: '2' },
        'infants',
        'infants must not be more than adults',
      ],
      [
        'more than 9 seated passengers',
        { adults: '5', children: '5' },
        'children',
        'adults + children must be at most 9',
      ],
      [
        'a maximum price below the minimum, compared exactly',
        { minPrice: '100', maxPrice: '99.99' },
        'maxPrice',
        'maxPrice must not be less than minPrice',
      ],
      [
        'a return date on a one-way trip',
        { returnDate: '2026-12-27' },
        'returnDate',
        'returnDate is only allowed for a ROUND_TRIP',
      ],
      [
        'a round trip without a return date',
        { tripType: 'ROUND_TRIP' },
        'returnDate',
        'returnDate is required for a ROUND_TRIP',
      ],
      [
        'a return date that does not exist',
        { tripType: 'ROUND_TRIP', returnDate: '2026-02-30' },
        'returnDate',
        'returnDate must be a valid local date (YYYY-MM-DD)',
      ],
      [
        'a return before the departure',
        { tripType: 'ROUND_TRIP', returnDate: '2026-12-19' },
        'returnDate',
        'returnDate must not be before departureDate',
      ],
    ])('rejects %s', async (_case, extra, field, message) => {
      await expect(fieldErrors({ ...BASE, ...extra })).resolves.toEqual([
        { field, messages: [message] },
      ]);
    });

    it('reports only the broken field when the other one is itself invalid', async () => {
      await expect(
        failedFields({ ...BASE, adults: 'many', infants: '3' }),
      ).resolves.toEqual(['adults']);
    });
  });
});
