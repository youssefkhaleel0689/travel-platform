import { IsOptional, validate } from 'class-validator';
import { flattenValidationErrors } from '../validation/validation-exception.factory';
import { IsLocalDate, IsLocalDateTime } from './local-date-time.validators';

class SearchDto {
  @IsLocalDate()
  departureDate: unknown;

  @IsOptional()
  @IsLocalDate()
  returnDate?: unknown;
}

class CreateDto {
  @IsLocalDateTime()
  departureLocal: unknown;
}

// Runs class-validator and returns the errors in the GEN-02 response format.
async function fieldErrors(dto: object) {
  return flattenValidationErrors(await validate(dto));
}

function searchDto(values: Partial<SearchDto>): SearchDto {
  return Object.assign(new SearchDto(), values);
}

describe('IsLocalDate', () => {
  it('accepts a date that exists', async () => {
    await expect(
      fieldErrors(searchDto({ departureDate: '2026-11-20' })),
    ).resolves.toEqual([]);
  });

  it.each(['2026-02-30', '2026-11-20T08:30', '20/11/2026', 20261120])(
    'reports %s as a field error',
    async (value) => {
      await expect(
        fieldErrors(searchDto({ departureDate: value })),
      ).resolves.toEqual([
        {
          field: 'departureDate',
          messages: ['departureDate must be a valid local date (YYYY-MM-DD)'],
        },
      ]);
    },
  );

  it('rejects a missing value unless the field is optional', async () => {
    await expect(fieldErrors(searchDto({}))).resolves.toEqual([
      {
        field: 'departureDate',
        messages: ['departureDate must be a valid local date (YYYY-MM-DD)'],
      },
    ]);
  });

  it('still checks an optional field when it is sent', async () => {
    const errors = await fieldErrors(
      searchDto({ departureDate: '2026-11-20', returnDate: '2026-11-31' }),
    );
    expect(errors.map((e) => e.field)).toEqual(['returnDate']);
  });
});

describe('IsLocalDateTime', () => {
  it('accepts a date and time that exist', async () => {
    const dto = Object.assign(new CreateDto(), {
      departureLocal: '2026-11-20T08:30',
    });
    await expect(fieldErrors(dto)).resolves.toEqual([]);
  });

  it.each(['2026-11-20T24:00', '2026-11-20T08:30:00', '2026-11-20T08:30Z'])(
    'reports %s as a field error',
    async (value) => {
      const dto = Object.assign(new CreateDto(), { departureLocal: value });
      await expect(fieldErrors(dto)).resolves.toEqual([
        {
          field: 'departureLocal',
          messages: [
            'departureLocal must be a valid local date and time (YYYY-MM-DDTHH:mm)',
          ],
        },
      ]);
    },
  );
});
