import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFlightDto } from './update-flight.dto';

async function errorFields(plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(UpdateFlightDto, plain));
  return errors.map((error) => error.property).sort();
}

describe('UpdateFlightDto (FLT-05)', () => {
  it('accepts any one field on its own', async () => {
    expect(
      await errorFields({ departureLocalInput: '2026-12-20T09:15' }),
    ).toEqual([]);
    expect(
      await errorFields({ arrivalLocalInput: '2026-12-20T15:15' }),
    ).toEqual([]);
    expect(await errorFields({ departureAirportId: 'CAI' })).toEqual([]);
    expect(await errorFields({ arrivalAirportId: 'DXB' })).toEqual([]);
  });

  it('accepts an empty body (the service answers EMPTY_UPDATE)', async () => {
    expect(await errorFields({})).toEqual([]);
  });

  it('trims, and upper-cases the airport codes', async () => {
    const dto = plainToInstance(UpdateFlightDto, {
      departureAirportId: ' cai ',
      arrivalAirportId: 'dxb',
      departureLocalInput: ' 2026-12-20T09:15 ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2026-12-20T09:15',
    });
  });

  it.each(['CA', 'CAIR', '12A', ''])(
    'rejects the airport code %p',
    async (code) => {
      expect(await errorFields({ departureAirportId: code })).toEqual([
        'departureAirportId',
      ]);
    },
  );

  it.each([
    '2026-12-20',
    '2026-12-20 09:15',
    '2026-12-20T25:00',
    '2026-02-30T10:00',
    '',
  ])('rejects the local time %p', async (value) => {
    expect(await errorFields({ arrivalLocalInput: value })).toEqual([
      'arrivalLocalInput',
    ]);
  });

  it('rejects null for every field (null is not "left out")', async () => {
    expect(
      await errorFields({
        departureAirportId: null,
        arrivalAirportId: null,
        departureLocalInput: null,
        arrivalLocalInput: null,
      }),
    ).toEqual([
      'arrivalAirportId',
      'arrivalLocalInput',
      'departureAirportId',
      'departureLocalInput',
    ]);
  });
});
