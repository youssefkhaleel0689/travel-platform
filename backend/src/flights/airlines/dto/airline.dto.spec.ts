import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AirlineIdParamDto } from './airline-id-param.dto';
import { CreateAirlineDto } from './create-airline.dto';
import { UpdateAirlineDto } from './update-airline.dto';

async function errorFields<T extends object>(
  type: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, plain));
  return errors.map((error) => error.property).sort();
}

describe('CreateAirlineDto (FLT-01)', () => {
  it('accepts a valid body and upper-cases and trims the codes', async () => {
    const dto = plainToInstance(CreateAirlineDto, {
      name: '  EgyptAir ',
      iataCode: ' ms ',
      icaoCode: 'msr',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      name: 'EgyptAir',
      iataCode: 'MS',
      icaoCode: 'MSR',
    });
  });

  it('accepts an IATA code with a digit (9W) and no icaoCode', async () => {
    expect(
      await errorFields(CreateAirlineDto, {
        name: 'Jet Airways',
        iataCode: '9W',
      }),
    ).toEqual([]);
  });

  it('reports every bad field', async () => {
    expect(
      await errorFields(CreateAirlineDto, {
        name: '   ',
        iataCode: 'MSR',
        icaoCode: 'MS',
      }),
    ).toEqual(['iataCode', 'icaoCode', 'name']);
  });

  it('rejects missing and non-string values', async () => {
    expect(await errorFields(CreateAirlineDto, {})).toEqual([
      'iataCode',
      'name',
    ]);
    expect(
      await errorFields(CreateAirlineDto, { name: 5, iataCode: ['MS'] }),
    ).toEqual(['iataCode', 'name']);
  });

  it('rejects a name over 100 characters', async () => {
    expect(
      await errorFields(CreateAirlineDto, {
        name: 'a'.repeat(101),
        iataCode: 'MS',
      }),
    ).toEqual(['name']);
  });
});

describe('UpdateAirlineDto (FLT-01)', () => {
  it('makes every field optional but still validates the ones sent', async () => {
    expect(await errorFields(UpdateAirlineDto, {})).toEqual([]);
    expect(await errorFields(UpdateAirlineDto, { name: 'New name' })).toEqual(
      [],
    );
    expect(
      await errorFields(UpdateAirlineDto, { iataCode: 'TOOLONG' }),
    ).toEqual(['iataCode']);
  });
});

describe('AirlineIdParamDto', () => {
  it('accepts an ObjectId and rejects anything else', async () => {
    expect(
      await errorFields(AirlineIdParamDto, { id: '6720f1c2a1b2c3d4e5f60718' }),
    ).toEqual([]);
    expect(await errorFields(AirlineIdParamDto, { id: 'abc' })).toEqual(['id']);
  });
});
