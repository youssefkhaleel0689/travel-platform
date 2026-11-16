import { Error as MongooseError, model, Schema, Types } from 'mongoose';
import { CabinCategory } from './flight.schema';
import {
  BookingStatus,
  FlightBooking,
  FlightBookingSchema,
  PassengerType,
  TripType,
} from './flight-booking.schema';

// One model for the whole file. validate() needs no database connection.
const FlightBookingModel = model(FlightBooking.name, FlightBookingSchema);

// Returns the invalid paths.
async function errorPaths(doc: Record<string, unknown>): Promise<string[]> {
  try {
    await new FlightBookingModel(doc).validate();
    return [];
  } catch (error) {
    if (error instanceof MongooseError.ValidationError) {
      return Object.keys(error.errors);
    }
    throw error;
  }
}

const ADULT_ID = new Types.ObjectId();
const INFANT_ID = new Types.ObjectId();

function segment(overrides: Record<string, unknown> = {}) {
  return {
    flightId: new Types.ObjectId(),
    airlineId: new Types.ObjectId(),
    flightNumber: 'MS777',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAtUtc: new Date('2026-12-01T06:30:00Z'),
    arrivalAtUtc: new Date('2026-12-01T09:00:00Z'),
    cabinCategory: CabinCategory.ECONOMY,
    seatsRequired: 1,
    cabinPrice: '199.99',
    freeBaggageCount: 1,
    maxBagWeightKg: 23,
    ...overrides,
  };
}

const adult = {
  _id: ADULT_ID,
  fullName: 'Khaled Test',
  dateOfBirth: '1990-05-14',
  passengerType: PassengerType.ADULT,
  documentNumber: 'A1234567',
  fareAmount: '199.99',
  seatRequired: true,
};

const infant = {
  _id: INFANT_ID,
  fullName: 'Baby Test',
  dateOfBirth: '2025-08-01',
  passengerType: PassengerType.INFANT,
  documentNumber: 'B7654321',
  fareAmount: '20.00',
  seatRequired: false,
};

// A valid one-way booking for one adult and one infant (one seat).
function booking(overrides: Record<string, unknown> = {}) {
  return {
    userId: new Types.ObjectId(),
    tripType: TripType.ONE_WAY,
    holdExpiresAt: new Date('2026-11-10T20:10:00Z'),
    segments: [segment()],
    passengers: [adult, infant],
    baggage: [
      {
        passengerId: ADULT_ID,
        extraBagCount: 1,
        extraBagWeightKg: 20,
        fee: '50.00',
      },
    ],
    priceSnapshot: {
      subtotal: '219.99',
      baggageTotal: '50.00',
      total: '269.99',
      baggagePolicySnapshot: {
        extraBagPrice: '50.00',
        maxExtraBagsPerPassenger: 2,
      },
    },
    ...overrides,
  };
}

describe('FlightBooking schema (FLT-22)', () => {
  describe('collection and indexes', () => {
    it('pins the collection name', () => {
      expect(FlightBookingSchema.get('collection')).toBe('flightBookings');
    });

    it.each([
      [{ userId: 1, status: 1 }],
      [{ status: 1, holdExpiresAt: 1 }],
      [{ 'segments.flightId': 1, status: 1 }],
    ])('has the index %o', (fields) => {
      expect(FlightBookingSchema.indexes()).toContainEqual([
        fields,
        expect.any(Object),
      ]);
    });

    it('makes bookingReference unique only once it is set', () => {
      expect(FlightBookingSchema.indexes()).toContainEqual([
        { bookingReference: 1 },
        expect.objectContaining({
          unique: true,
          partialFilterExpression: { bookingReference: { $type: 'string' } },
        }),
      ]);
    });

    it('stores money as Decimal128', () => {
      const path = (schema: Schema, name: string) => schema.path(name).instance;
      const segments = FlightBookingSchema.path(
        'segments',
      ) as Schema.Types.DocumentArray;
      const passengers = FlightBookingSchema.path(
        'passengers',
      ) as Schema.Types.DocumentArray;
      expect(path(segments.schema, 'cabinPrice')).toBe('Decimal128');
      expect(path(passengers.schema, 'fareAmount')).toBe('Decimal128');
      expect(FlightBookingSchema.path('priceSnapshot.total').instance).toBe(
        'Decimal128',
      );
    });
  });

  describe('defaults and lifecycle', () => {
    it('accepts a valid one-way booking', async () => {
      await expect(errorPaths(booking())).resolves.toEqual([]);
    });

    it('starts as PENDING_PAYMENT in USD with no reference and no cancellation', () => {
      const doc = new FlightBookingModel(booking());
      expect(doc.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(doc.priceSnapshot.currency).toBe('USD');
      expect(doc.bookingReference).toBeUndefined();
      expect(doc.cancellation).toBeNull();
    });

    it('allows only the GEN-11 statuses', () => {
      expect(Object.values(BookingStatus)).toEqual([
        'PENDING_PAYMENT',
        'CONFIRMED',
        'COMPLETED',
        'EXPIRED',
        'CANCELLED',
      ]);
    });

    it('rejects a status outside the lifecycle and a currency other than USD', async () => {
      const doc = booking({ status: 'DRAFT' });
      (
        doc as { priceSnapshot: Record<string, unknown> }
      ).priceSnapshot.currency = 'EUR';
      await expect(errorPaths(doc)).resolves.toEqual(
        expect.arrayContaining(['status', 'priceSnapshot.currency']),
      );
    });
  });

  describe('segments (FLT-12, FLT-22)', () => {
    it('accepts a round trip with two segments', async () => {
      await expect(
        errorPaths(
          booking({
            tripType: TripType.ROUND_TRIP,
            segments: [segment(), segment()],
          }),
        ),
      ).resolves.toEqual([]);
    });

    it.each([
      ['ONE_WAY with two segments', TripType.ONE_WAY, 2],
      ['ROUND_TRIP with one segment', TripType.ROUND_TRIP, 1],
    ])('rejects %s', async (_case, tripType, count) => {
      const segments = Array.from({ length: count }, () => segment());
      await expect(
        errorPaths(booking({ tripType, segments })),
      ).resolves.toEqual(['segments']);
    });

    it('rejects seatsRequired that counts the infant', async () => {
      await expect(
        errorPaths(booking({ segments: [segment({ seatsRequired: 2 })] })),
      ).resolves.toEqual(['segments']);
    });
  });

  describe('passengers (FLT-12, FLT-19)', () => {
    it('rejects a booking without an adult', async () => {
      await expect(
        errorPaths(booking({ passengers: [infant], baggage: [] })),
      ).resolves.toContain('passengers');
    });

    it('rejects more infants than adults', async () => {
      const secondInfant = { ...infant, _id: new Types.ObjectId() };
      await expect(
        errorPaths(booking({ passengers: [adult, infant, secondInfant] })),
      ).resolves.toEqual(['passengers']);
    });

    it('rejects an infant with a seat and an adult without one', async () => {
      const passengers = [
        { ...adult, seatRequired: false },
        { ...infant, seatRequired: true },
      ];
      await expect(errorPaths(booking({ passengers }))).resolves.toEqual(
        expect.arrayContaining([
          'passengers.0.seatRequired',
          'passengers.1.seatRequired',
        ]),
      );
    });

    it('rejects a date of birth that does not exist', async () => {
      const passengers = [{ ...adult, dateOfBirth: '1990-02-30' }, infant];
      await expect(errorPaths(booking({ passengers }))).resolves.toEqual([
        'passengers.0.dateOfBirth',
      ]);
    });
  });

  describe('baggage and money', () => {
    it('rejects baggage for someone who is not a passenger', async () => {
      const baggage = [
        {
          passengerId: new Types.ObjectId(),
          extraBagCount: 1,
          extraBagWeightKg: 20,
          fee: '50.00',
        },
      ];
      await expect(errorPaths(booking({ baggage }))).resolves.toEqual([
        'baggage',
      ]);
    });

    it('rejects a zero fare and a negative baggage fee', async () => {
      const passengers = [{ ...adult, fareAmount: '0' }, infant];
      const baggage = [
        {
          passengerId: ADULT_ID,
          extraBagCount: 1,
          extraBagWeightKg: 20,
          fee: '-1',
        },
      ];
      await expect(
        errorPaths(booking({ passengers, baggage })),
      ).resolves.toEqual(
        expect.arrayContaining(['passengers.0.fareAmount', 'baggage.0.fee']),
      );
    });
  });
});
