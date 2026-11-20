import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../../common/validation/validation-exception.factory';
import { PassengerType, TripType } from '../../schemas/flight-booking.schema';
import { CabinCategory } from '../../schemas/flight.schema';
import {
  FlightBookingRequestDto,
  PassengerDto,
} from './flight-booking-request.dto';

// Same options as configureApp in src/app.setup.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

const OUTBOUND_ID = '6720f1c2a1b2c3d4e5f60719';
const INBOUND_ID = '6720f1c2a1b2c3d4e5f6071a';

function passenger(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Khaled Elshitany',
    dateOfBirth: '2004-03-10',
    passengerType: 'ADULT',
    documentNumber: 'A12345678',
    ...overrides,
  };
}

const adult = passenger();
const child = passenger({ dateOfBirth: '2018-01-01', passengerType: 'CHILD' });
const infant = passenger({
  dateOfBirth: '2025-08-01',
  passengerType: 'INFANT',
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    outbound: { flightId: OUTBOUND_ID, cabin: 'ECONOMY' },
    passengers: [adult],
    ...overrides,
  };
}

function transform(value: unknown): Promise<FlightBookingRequestDto> {
  return pipe.transform(value, {
    type: 'body',
    metatype: FlightBookingRequestDto,
  }) as Promise<FlightBookingRequestDto>;
}

// The field errors of a rejected body, in the GEN-02 { field, messages } shape.
async function fieldErrors(
  value: unknown,
): Promise<{ field: string; messages: string[] }[]> {
  try {
    await transform(value);
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

async function failedFields(value: unknown): Promise<string[]> {
  return (await fieldErrors(value)).map((e) => e.field);
}

describe('FlightBookingRequestDto (FLT-19, FLT-22)', () => {
  describe('valid bodies', () => {
    it('defaults to ONE_WAY and normalises the text fields', async () => {
      const dto = await transform(
        body({
          outbound: { flightId: OUTBOUND_ID, cabin: ' economy ' },
          passengers: [
            passenger({
              fullName: '  Khaled Elshitany  ',
              passengerType: 'adult',
              documentNumber: ' a12345678 ',
            }),
          ],
        }),
      );

      expect(dto.tripType).toBe(TripType.ONE_WAY);
      expect(dto.outbound).toEqual({
        flightId: OUTBOUND_ID,
        cabin: CabinCategory.ECONOMY,
      });
      expect(dto.passengers[0]).toBeInstanceOf(PassengerDto);
      expect(dto.passengers[0]).toMatchObject({
        fullName: 'Khaled Elshitany',
        passengerType: PassengerType.ADULT,
        documentNumber: 'A12345678',
      });
      expect(dto.inbound).toBeUndefined();
    });

    it('accepts a round trip with extra bags', async () => {
      const dto = await transform(
        body({
          tripType: 'ROUND_TRIP',
          inbound: { flightId: INBOUND_ID, cabin: 'BUSINESS' },
          passengers: [
            passenger({ extraBags: { count: 2, weightKg: 23.5 } }),
            child,
          ],
        }),
      );

      expect(dto.tripType).toBe(TripType.ROUND_TRIP);
      expect(dto.inbound?.cabin).toBe(CabinCategory.BUSINESS);
      expect(dto.passengers[0].extraBags).toEqual({ count: 2, weightKg: 23.5 });
    });

    it('accepts 9 adults with 9 infants: infants take no seat', async () => {
      const passengers = [
        ...Array.from({ length: 9 }, () => adult),
        ...Array.from({ length: 9 }, () => infant),
      ];
      await expect(fieldErrors(body({ passengers }))).resolves.toEqual([]);
    });
  });

  describe('the trip', () => {
    it('requires outbound', async () => {
      await expect(fieldErrors(body({ outbound: undefined }))).resolves.toEqual(
        [{ field: 'outbound', messages: ['outbound is required'] }],
      );
    });

    it('rejects an outbound that is not an object', async () => {
      await expect(failedFields(body({ outbound: 'MS910' }))).resolves.toEqual([
        'outbound',
      ]);
    });

    it('requires inbound for a ROUND_TRIP', async () => {
      await expect(
        fieldErrors(body({ tripType: 'ROUND_TRIP' })),
      ).resolves.toEqual([
        {
          field: 'inbound',
          messages: ['inbound is required for a ROUND_TRIP'],
        },
      ]);
    });

    it('rejects inbound on a ONE_WAY trip', async () => {
      await expect(
        fieldErrors(
          body({ inbound: { flightId: INBOUND_ID, cabin: 'ECONOMY' } }),
        ),
      ).resolves.toEqual([
        {
          field: 'inbound',
          messages: ['inbound is only allowed for a ROUND_TRIP'],
        },
      ]);
    });

    it('checks the flight id and the cabin of each flight', async () => {
      await expect(
        failedFields(
          body({
            tripType: 'ROUND_TRIP',
            outbound: { flightId: 'abc', cabin: 'ECONOMY' },
            inbound: { flightId: INBOUND_ID, cabin: 'LOUNGE' },
          }),
        ),
      ).resolves.toEqual(['outbound.flightId', 'inbound.cabin']);
    });

    it('rejects an unknown trip type', async () => {
      await expect(
        failedFields(body({ tripType: 'MULTI_CITY' })),
      ).resolves.toEqual(['tripType']);
    });
  });

  describe('the party (FLT-12)', () => {
    it.each([
      ['no adult', [child], 'passengers must include at least one adult'],
      [
        'more infants than adults',
        [adult, infant, infant],
        'passengers must not have more infants than adults',
      ],
      [
        '10 seated passengers',
        [...Array.from({ length: 9 }, () => adult), child],
        'passengers must have at most 9 adults and children',
      ],
    ])('rejects %s with one message', async (_case, passengers, message) => {
      await expect(fieldErrors(body({ passengers }))).resolves.toEqual([
        { field: 'passengers', messages: [message] },
      ]);
    });

    it('rejects an empty list with the size error only', async () => {
      await expect(fieldErrors(body({ passengers: [] }))).resolves.toEqual([
        {
          field: 'passengers',
          messages: ['passengers must contain at least 1 elements'],
        },
      ]);
    });

    it('reports a passenger that is not an object on that passenger only', async () => {
      await expect(
        failedFields(body({ passengers: ['Khaled'] })),
      ).resolves.toEqual(['passengers.0']);
    });

    it('rejects passengers that are not a list', async () => {
      await expect(
        failedFields(body({ passengers: 'Khaled' })),
      ).resolves.toEqual(['passengers']);
    });
  });

  describe('one passenger (FLT-19)', () => {
    it.each([
      ['an empty name', { fullName: '   ' }, 'fullName'],
      ['a name over 100 characters', { fullName: 'K'.repeat(101) }, 'fullName'],
      [
        'a date that does not exist',
        { dateOfBirth: '2004-02-30' },
        'dateOfBirth',
      ],
      ['an unknown type', { passengerType: 'SENIOR' }, 'passengerType'],
      [
        'a document number with symbols',
        { documentNumber: 'A1-234' },
        'documentNumber',
      ],
      [
        'a document number that is too short',
        { documentNumber: 'A123' },
        'documentNumber',
      ],
    ])('rejects %s', async (_case, change, field) => {
      await expect(
        failedFields(body({ passengers: [passenger(change)] })),
      ).resolves.toEqual([`passengers.0.${field}`]);
    });

    it('checks the count and the weight of extra bags', async () => {
      const passengers = [
        passenger({ extraBags: { count: 0, weightKg: 20.25 } }),
      ];
      await expect(failedFields(body({ passengers }))).resolves.toEqual([
        'passengers.0.extraBags.count',
        'passengers.0.extraBags.weightKg',
      ]);
    });

    it('rejects a fare sent by the client', async () => {
      const passengers = [passenger({ fareAmount: '1.00' })];
      await expect(failedFields(body({ passengers }))).resolves.toEqual([
        'passengers.0.fareAmount',
      ]);
    });
  });

  it('rejects a total sent by the client: prices come from the flights', async () => {
    await expect(failedFields(body({ total: '1.00' }))).resolves.toEqual([
      'total',
    ]);
  });
});
