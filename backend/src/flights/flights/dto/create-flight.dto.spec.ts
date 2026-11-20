import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFlightDto } from './create-flight.dto';

const VALID = {
  flightNumber: 'MS777',
  departureAirportId: 'CAI',
  arrivalAirportId: 'DXB',
  departureLocalInput: '2026-12-20T08:30',
  arrivalLocalInput: '2026-12-20T14:30',
};

async function errorFields(plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(CreateFlightDto, plain));
  return errors.map((error) => error.property).sort();
}

describe('CreateFlightDto (FLT-03)', () => {
  it('accepts a valid body', async () => {
    expect(await errorFields(VALID)).toEqual([]);
  });

  it('trims, and upper-cases the flight number and the airport codes', async () => {
    const dto = plainToInstance(CreateFlightDto, {
      flightNumber: ' ms777 ',
      departureAirportId: ' cai ',
      arrivalAirportId: 'dxb',
      departureLocalInput: ' 2026-12-20T08:30 ',
      arrivalLocalInput: '2026-12-20T14:30',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      flightNumber: 'MS777',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2026-12-20T08:30',
    });
  });

  it.each(['M', 'MS 777', 'MS-777', 'MS7777777777', ''])(
    'rejects the flight number "%s"',
    async (flightNumber) => {
      expect(await errorFields({ ...VALID, flightNumber })).toEqual([
        'flightNumber',
      ]);
    },
  );

  it.each(['CA', 'CAIR', 'C1I', ''])(
    'rejects the airport code "%s" on both airport fields',
    async (code) => {
      expect(
        await errorFields({
          ...VALID,
          departureAirportId: code,
          arrivalAirportId: code,
        }),
      ).toEqual(['arrivalAirportId', 'departureAirportId']);
    },
  );

  it.each([
    '2026-12-20 08:30',
    '2026-12-20T08:30:00',
    '2026-12-20T08:30Z',
    '2026-12-20T08:30+02:00',
    '2026-12-20T25:00',
    '2026-02-30T08:30',
    '2026-12-20',
    'tomorrow',
  ])('rejects the local date-time "%s"', async (value) => {
    expect(
      await errorFields({
        ...VALID,
        departureLocalInput: value,
        arrivalLocalInput: value,
      }),
    ).toEqual(['arrivalLocalInput', 'departureLocalInput']);
  });

  it('reports every missing field', async () => {
    expect(await errorFields({})).toEqual([
      'arrivalAirportId',
      'arrivalLocalInput',
      'departureAirportId',
      'departureLocalInput',
      'flightNumber',
    ]);
  });

  it('rejects non-string values', async () => {
    expect(
      await errorFields({
        flightNumber: 777,
        departureAirportId: ['CAI'],
        arrivalAirportId: { code: 'DXB' },
        departureLocalInput: 20261220,
        arrivalLocalInput: null,
      }),
    ).toEqual([
      'arrivalAirportId',
      'arrivalLocalInput',
      'departureAirportId',
      'departureLocalInput',
      'flightNumber',
    ]);
  });
});
