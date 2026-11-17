import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../validation/validation-exception.factory';
import { AirportsQueryDto } from './airports-query.dto';
import { CitiesQueryDto } from './cities-query.dto';

// Same options as configureApp in src/app.setup.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

function validate<T>(metatype: Type<T>, query: Record<string, unknown>) {
  return pipe.transform(query, { type: 'query', metatype }) as Promise<T>;
}

// Returns the field names reported by a rejected query.
async function rejectedFields<T>(
  metatype: Type<T>,
  query: Record<string, unknown>,
): Promise<string[]> {
  try {
    await validate(metatype, query);
  } catch (error) {
    if (error instanceof BadRequestException) {
      const body = error.getResponse() as { errors: { field: string }[] };
      return body.errors.map((e) => e.field);
    }
    throw error;
  }
  return [];
}

describe('reference data query DTOs', () => {
  it('accepts valid airport filters and keeps the inherited page', async () => {
    const query = await validate(AirportsQueryDto, {
      page: '2',
      cityId: 'new_york',
      countryId: 'US',
    });
    expect(query.page).toBe(2);
    expect(query.cityId).toBe('new_york');
    expect(query.countryId).toBe('US');
  });

  it('defaults page to 1 when no params are given', async () => {
    const query = await validate(CitiesQueryDto, {});
    expect(query.page).toBe(1);
    expect(query.countryId).toBeUndefined();
  });

  it.each([
    ['AirportsQueryDto', AirportsQueryDto],
    ['CitiesQueryDto', CitiesQueryDto],
  ])('%s still rejects limit', async (_name, metatype) => {
    await expect(rejectedFields(metatype, { limit: '50' })).resolves.toEqual([
      'limit',
    ]);
  });

  it('still validates the inherited page', async () => {
    await expect(
      rejectedFields(AirportsQueryDto, { page: '0' }),
    ).resolves.toEqual(['page']);
  });

  it('rejects a bad cityId and a bad countryId together', async () => {
    await expect(
      rejectedFields(AirportsQueryDto, { cityId: 'New York', countryId: 'eg' }),
    ).resolves.toEqual(['cityId', 'countryId']);
  });

  it('rejects a bad countryId on cities', async () => {
    await expect(
      rejectedFields(CitiesQueryDto, { countryId: 'EGY' }),
    ).resolves.toEqual(['countryId']);
  });

  it('rejects a query operator object instead of a string', async () => {
    await expect(
      rejectedFields(AirportsQueryDto, { cityId: { $ne: 'cairo' } }),
    ).resolves.toEqual(['cityId']);
  });
});
