import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../../common/validation/validation-exception.factory';
import { ItineraryFlightSearchQueryDto } from './itinerary-flight-search-query.dto';

// Same options as configureApp in src/app.setup.ts, so this is what a request gets.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: ItineraryFlightSearchQueryDto,
};

async function validate(
  query: Record<string, string>,
): Promise<ItineraryFlightSearchQueryDto> {
  return (await pipe.transform(
    query,
    metadata,
  )) as ItineraryFlightSearchQueryDto;
}

async function fieldErrors(
  query: Record<string, string>,
): Promise<Record<string, string[]>> {
  try {
    await validate(query);
  } catch (error) {
    const body = (error as BadRequestException).getResponse() as {
      errors: { field: string; messages: string[] }[];
    };
    return Object.fromEntries(body.errors.map((e) => [e.field, e.messages]));
  }
  throw new Error('expected validation to fail');
}

describe('ItineraryFlightSearchQueryDto (ITN-26)', () => {
  it('needs only the origin airport; everything else has a default', async () => {
    const query = await validate({ originAirportId: ' cai ' });

    expect(query).toMatchObject({
      originAirportId: 'CAI',
      tripType: 'ONE_WAY',
      adults: 1,
      children: 0,
      infants: 0,
      sortBy: 'price',
      sortOrder: 'asc',
      page: 1,
      returnPage: 1,
    });
    expect(query.departureDate).toBeUndefined();
    expect(query.returnDate).toBeUndefined();
  });

  it('takes a round trip without dates: the itinerary gives them', async () => {
    await expect(
      validate({ originAirportId: 'CAI', tripType: 'ROUND_TRIP' }),
    ).resolves.toMatchObject({ tripType: 'ROUND_TRIP' });
  });

  it('rejects a missing or malformed origin airport', async () => {
    expect(await fieldErrors({})).toHaveProperty('originAirportId');
    expect(await fieldErrors({ originAirportId: 'CAIRO' })).toEqual({
      originAirportId: [
        'originAirportId must be a 3-letter IATA code (for example CAI)',
      ],
    });
  });

  it('refuses the search destination: it comes from the itinerary', async () => {
    expect(
      await fieldErrors({ originAirportId: 'CAI', arrivalAirportId: 'DXB' }),
    ).toHaveProperty('arrivalAirportId');
  });

  it('checks the return date against the trip type and the departure date', async () => {
    expect(
      await fieldErrors({ originAirportId: 'CAI', returnDate: '2026-12-27' }),
    ).toEqual({ returnDate: ['returnDate is only allowed for a ROUND_TRIP'] });
    expect(
      await fieldErrors({
        originAirportId: 'CAI',
        tripType: 'ROUND_TRIP',
        returnDate: '2026-13-01',
      }),
    ).toEqual({
      returnDate: ['returnDate must be a valid local date (YYYY-MM-DD)'],
    });
    expect(
      await fieldErrors({
        originAirportId: 'CAI',
        tripType: 'ROUND_TRIP',
        departureDate: '2026-12-20',
        returnDate: '2026-12-19',
      }),
    ).toEqual({ returnDate: ['returnDate must not be before departureDate'] });
  });

  it('keeps the search rules for passengers and prices', async () => {
    expect(
      await fieldErrors({ originAirportId: 'CAI', adults: '1', infants: '2' }),
    ).toHaveProperty('infants');
    expect(
      await fieldErrors({
        originAirportId: 'CAI',
        minPrice: '500',
        maxPrice: '100',
      }),
    ).toHaveProperty('maxPrice');
  });
});
