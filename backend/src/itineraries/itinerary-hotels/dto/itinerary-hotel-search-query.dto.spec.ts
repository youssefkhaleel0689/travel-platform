import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../../common/validation/validation-exception.factory';
import { HotelSortBy } from '../../../hotel-search/dto/hotel-search.dto';
import { ItineraryHotelSearchQueryDto } from './itinerary-hotel-search-query.dto';

// Same options as configureApp in src/app.setup.ts, so this is what a request gets.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: ItineraryHotelSearchQueryDto,
};

async function validate(
  query: Record<string, string>,
): Promise<ItineraryHotelSearchQueryDto> {
  return (await pipe.transform(
    query,
    metadata,
  )) as ItineraryHotelSearchQueryDto;
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

describe('ItineraryHotelSearchQueryDto (ITN-25)', () => {
  it('needs cityGroup and guestCount; roomCount, sorting and page have defaults', async () => {
    const query = await validate({ cityGroup: '2', guestCount: '3' });

    expect(query).toMatchObject({
      cityGroup: 2,
      guestCount: 3,
      roomCount: 1,
      sortBy: HotelSortBy.PRICE,
      page: 1,
    });
  });

  it('rejects a missing or non-positive cityGroup', async () => {
    expect(await fieldErrors({ guestCount: '1' })).toHaveProperty('cityGroup');
    expect(await fieldErrors({ cityGroup: '0', guestCount: '1' })).toEqual({
      cityGroup: ['cityGroup must not be less than 1'],
    });
    expect(await fieldErrors({ cityGroup: '1.5', guestCount: '1' })).toEqual({
      cityGroup: ['cityGroup must be an integer number'],
    });
  });

  it('rejects guestCount 0 and roomCount 0 like hotel search does', async () => {
    expect(await fieldErrors({ cityGroup: '1', guestCount: '0' })).toEqual({
      guestCount: ['guestCount must not be less than 1'],
    });
    expect(
      await fieldErrors({ cityGroup: '1', guestCount: '1', roomCount: '0' }),
    ).toEqual({ roomCount: ['roomCount must not be less than 1'] });
  });

  it.each(['cityId', 'countryId', 'checkInDate', 'checkOutDate'])(
    'does not accept %s: the city group decides it',
    async (field) => {
      expect(
        await fieldErrors({ cityGroup: '1', guestCount: '1', [field]: 'x' }),
      ).toHaveProperty(field);
    },
  );

  it('keeps the hotel search filters and their validation', async () => {
    expect(
      await fieldErrors({
        cityGroup: '1',
        guestCount: '1',
        maxPricePerNight: '-1',
        sortBy: 'distance',
      }),
    ).toEqual({
      maxPricePerNight: ['maxPricePerNight must be a non-negative amount'],
      sortBy: [expect.stringContaining('sortBy must be one of')],
    });
  });
});
