import { Error as MongooseError, model, Schema, Types } from 'mongoose';
import {
  CabinCategory,
  Flight,
  FlightSchema,
  FlightStatus,
} from './flight.schema';

// One model for the whole file. validate() needs no database connection.
const FlightModel = model(Flight.name, FlightSchema);

// Returns the invalid paths.
async function errorPaths(doc: Record<string, unknown>): Promise<string[]> {
  try {
    await new FlightModel(doc).validate();
    return [];
  } catch (error) {
    if (error instanceof MongooseError.ValidationError) {
      return Object.keys(error.errors);
    }
    throw error;
  }
}

const validCabin = {
  category: CabinCategory.ECONOMY,
  totalSeats: 150,
  price: '199.99',
  freeBaggageCount: 1,
  maxBagWeightKg: 23,
};

const validFlight = {
  airlineId: new Types.ObjectId(),
  flightNumber: 'MS777',
  departureAirportId: 'CAI',
  arrivalAirportId: 'DXB',
  departureLocalInput: '2026-12-01T08:30',
  arrivalLocalInput: '2026-12-01T13:00',
  departureAtUtc: new Date('2026-12-01T06:30:00Z'),
  arrivalAtUtc: new Date('2026-12-01T09:00:00Z'),
  departureDateKey: '2026-12-01',
};

describe('Flight schema (FLT-03, FLT-04)', () => {
  describe('collection and indexes', () => {
    it('pins the collection name', () => {
      expect(FlightSchema.get('collection')).toBe('flights');
    });

    it('has the search index in the required order', () => {
      expect(FlightSchema.indexes()).toContainEqual([
        {
          departureAirportId: 1,
          arrivalAirportId: 1,
          departureDateKey: 1,
          status: 1,
        },
        expect.any(Object),
      ]);
    });

    it('has a status + departureAtUtc index for the DEPARTED job (FLT-30)', () => {
      expect(FlightSchema.indexes()).toContainEqual([
        { status: 1, departureAtUtc: 1 },
        expect.any(Object),
      ]);
    });

    it('has a unique airlineId + flightNumber + departureDateKey index', () => {
      expect(FlightSchema.indexes()).toContainEqual([
        { airlineId: 1, flightNumber: 1, departureDateKey: 1 },
        expect.objectContaining({ unique: true }),
      ]);
    });

    it('does not store a duration', () => {
      expect(FlightSchema.path('duration')).toBeUndefined();
      expect(FlightSchema.path('durationMinutes')).toBeUndefined();
    });

    it('stores the cabin price as Decimal128', () => {
      const cabins = FlightSchema.path(
        'cabinInventory',
      ) as Schema.Types.DocumentArray;
      expect(cabins.schema.path('price').instance).toBe('Decimal128');
    });
  });

  describe('flight fields', () => {
    it('accepts a flight with no cabins yet', async () => {
      await expect(errorPaths(validFlight)).resolves.toEqual([]);
    });

    it('defaults the status to SCHEDULED and the cabins to empty', () => {
      const flight = new FlightModel(validFlight);
      expect(flight.status).toBe(FlightStatus.SCHEDULED);
      expect(flight.cabinInventory).toHaveLength(0);
    });

    it('upper-cases and trims the flight number and airport ids', () => {
      const flight = new FlightModel({
        ...validFlight,
        flightNumber: ' ms777 ',
        departureAirportId: 'cai',
        arrivalAirportId: 'dxb',
      });
      expect(flight.flightNumber).toBe('MS777');
      expect(flight.departureAirportId).toBe('CAI');
      expect(flight.arrivalAirportId).toBe('DXB');
    });

    it.each([
      'airlineId',
      'flightNumber',
      'departureAirportId',
      'arrivalAirportId',
      'departureLocalInput',
      'arrivalLocalInput',
      'departureAtUtc',
      'arrivalAtUtc',
      'departureDateKey',
    ])('requires %s', async (field) => {
      const doc: Record<string, unknown> = { ...validFlight };
      delete doc[field];
      await expect(errorPaths(doc)).resolves.toContain(field);
    });

    it('rejects identical departure and arrival airports', async () => {
      const doc = { ...validFlight, arrivalAirportId: 'CAI' };
      await expect(errorPaths(doc)).resolves.toEqual(['arrivalAirportId']);
    });

    it('rejects an airport id that is not a 3-letter code', async () => {
      const doc = { ...validFlight, arrivalAirportId: 'dubai' };
      await expect(errorPaths(doc)).resolves.toEqual(['arrivalAirportId']);
    });

    it('rejects an arrival equal to the departure', async () => {
      const doc = { ...validFlight, arrivalAtUtc: validFlight.departureAtUtc };
      await expect(errorPaths(doc)).resolves.toEqual(['arrivalAtUtc']);
    });

    it('rejects an arrival before the departure', async () => {
      const doc = {
        ...validFlight,
        arrivalAtUtc: new Date('2026-12-01T05:00:00Z'),
      };
      await expect(errorPaths(doc)).resolves.toEqual(['arrivalAtUtc']);
    });

    it.each(['2026-12-1', '2026-02-30', '01-12-2026', '2026-12-01T00:00'])(
      'rejects departureDateKey %s',
      async (departureDateKey) => {
        const doc = { ...validFlight, departureDateKey };
        await expect(errorPaths(doc)).resolves.toEqual(['departureDateKey']);
      },
    );

    it.each(['2026-12-01 08:30', '2026-12-01T24:00', '2026-12-01T08:30:00Z'])(
      'rejects local input %s',
      async (departureLocalInput) => {
        const doc = { ...validFlight, departureLocalInput };
        await expect(errorPaths(doc)).resolves.toEqual(['departureLocalInput']);
      },
    );

    it('rejects an unknown status', async () => {
      const doc = { ...validFlight, status: 'Scheduled' };
      await expect(errorPaths(doc)).resolves.toEqual(['status']);
    });

    it.each(Object.values(FlightStatus))(
      'accepts status %s',
      async (status) => {
        await expect(errorPaths({ ...validFlight, status })).resolves.toEqual(
          [],
        );
      },
    );
  });

  describe('cabinInventory[] (FLT-04)', () => {
    const withCabins = (...cabins: Record<string, unknown>[]) => ({
      ...validFlight,
      cabinInventory: cabins,
    });

    it('accepts all four categories once each', async () => {
      const cabins = Object.values(CabinCategory).map((category) => ({
        ...validCabin,
        category,
      }));
      await expect(errorPaths(withCabins(...cabins))).resolves.toEqual([]);
    });

    it('starts the counters at 0', () => {
      const flight = new FlightModel(withCabins(validCabin));
      expect(flight.cabinInventory[0].bookedSeats).toBe(0);
      expect(flight.cabinInventory[0].heldSeats).toBe(0);
    });

    it('rejects the same category twice', async () => {
      const doc = withCabins(validCabin, { ...validCabin, totalSeats: 10 });
      await expect(errorPaths(doc)).resolves.toEqual(['cabinInventory']);
    });

    it('rejects a category outside the fixed set', async () => {
      const doc = withCabins({ ...validCabin, category: 'ECONOMY_PLUS' });
      await expect(errorPaths(doc)).resolves.toEqual([
        'cabinInventory.0.category',
      ]);
    });

    it.each([0, -5, 1.5])('rejects totalSeats %s', async (totalSeats) => {
      const doc = withCabins({ ...validCabin, totalSeats });
      await expect(errorPaths(doc)).resolves.toEqual([
        'cabinInventory.0.totalSeats',
      ]);
    });

    it.each(['0', '-10.00', 'NaN'])('rejects price %s', async (price) => {
      const doc = withCabins({ ...validCabin, price });
      await expect(errorPaths(doc)).resolves.toEqual([
        'cabinInventory.0.price',
      ]);
    });

    it('accepts a price with cents', async () => {
      const doc = withCabins({ ...validCabin, price: '0.01' });
      await expect(errorPaths(doc)).resolves.toEqual([]);
    });

    it('accepts 0 free bags but not a negative or fractional count', async () => {
      await expect(
        errorPaths(withCabins({ ...validCabin, freeBaggageCount: 0 })),
      ).resolves.toEqual([]);
      await expect(
        errorPaths(withCabins({ ...validCabin, freeBaggageCount: -1 })),
      ).resolves.toEqual(['cabinInventory.0.freeBaggageCount']);
      await expect(
        errorPaths(withCabins({ ...validCabin, freeBaggageCount: 1.5 })),
      ).resolves.toEqual(['cabinInventory.0.freeBaggageCount']);
    });

    it.each([0, -23])('rejects maxBagWeightKg %s', async (maxBagWeightKg) => {
      const doc = withCabins({ ...validCabin, maxBagWeightKg });
      await expect(errorPaths(doc)).resolves.toEqual([
        'cabinInventory.0.maxBagWeightKg',
      ]);
    });

    it.each([
      ['bookedSeats', -1],
      ['heldSeats', -1],
      ['bookedSeats', 1.5],
      ['heldSeats', 2.5],
    ])('rejects %s = %s', async (field, value) => {
      const doc = withCabins({ ...validCabin, [field]: value });
      await expect(errorPaths(doc)).resolves.toContain(
        `cabinInventory.0.${field}`,
      );
    });

    it('accepts bookedSeats + heldSeats equal to totalSeats', async () => {
      const doc = withCabins({
        ...validCabin,
        totalSeats: 10,
        bookedSeats: 6,
        heldSeats: 4,
      });
      await expect(errorPaths(doc)).resolves.toEqual([]);
    });

    it('rejects bookedSeats + heldSeats above totalSeats', async () => {
      const doc = withCabins({
        ...validCabin,
        totalSeats: 10,
        bookedSeats: 6,
        heldSeats: 5,
      });
      await expect(errorPaths(doc)).resolves.toEqual([
        'cabinInventory.0.totalSeats',
      ]);
    });

    it('requires every cabin field except the counters', async () => {
      const paths = await errorPaths(withCabins({}));
      expect(paths).toEqual(
        expect.arrayContaining([
          'cabinInventory.0.category',
          'cabinInventory.0.totalSeats',
          'cabinInventory.0.price',
          'cabinInventory.0.freeBaggageCount',
          'cabinInventory.0.maxBagWeightKg',
        ]),
      );
      expect(paths).not.toContain('cabinInventory.0.bookedSeats');
      expect(paths).not.toContain('cabinInventory.0.heldSeats');
    });
  });
});
