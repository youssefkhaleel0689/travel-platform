import { HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import {
  PassengerType,
  PolicySnapshot,
  TripType,
} from '../schemas/flight-booking.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import type { FlightBookingRequestDto } from './dto/flight-booking-request.dto';
import { FlightBookingPolicyReader } from './flight-booking-policy.reader';
import { FlightBookingsService } from './flight-bookings.service';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const AIRLINE_ID = new Types.ObjectId();
const OUTBOUND_ID = new Types.ObjectId();
const INBOUND_ID = new Types.ObjectId();

const ZONES: Record<string, string> = {
  CAI: 'Africa/Cairo',
  DXB: 'Asia/Dubai',
  JFK: 'America/New_York',
};

function cabin(
  category: CabinCategory,
  price: string,
  free: number,
  maxBagWeightKg: number,
) {
  return {
    category,
    totalSeats: 10,
    bookedSeats: 10 - free - 1,
    heldSeats: 1,
    price: Types.Decimal128.fromString(price),
    freeBaggageCount: 1,
    maxBagWeightKg,
  };
}

// CAI -> DXB on 2026-12-20: 08:30 in Cairo (UTC+2), 14:30 in Dubai (UTC+4).
function outboundFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    _id: OUTBOUND_ID,
    airlineId: AIRLINE_ID,
    flightNumber: 'MS910',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAtUtc: new Date('2026-12-20T06:30:00.000Z'),
    arrivalAtUtc: new Date('2026-12-20T10:30:00.000Z'),
    departureDateKey: '2026-12-20',
    status: FlightStatus.SCHEDULED,
    cabinInventory: [
      cabin(CabinCategory.ECONOMY, '199.99', 8, 23),
      cabin(CabinCategory.BUSINESS, '750.00', 2, 32),
    ],
    ...overrides,
  } as Flight;
}

// DXB -> CAI on 2026-12-27.
function inboundFlight(overrides: Partial<Flight> = {}): Flight {
  return outboundFlight({
    _id: INBOUND_ID,
    flightNumber: 'MS911',
    departureAirportId: 'DXB',
    arrivalAirportId: 'CAI',
    departureAtUtc: new Date('2026-12-27T12:00:00.000Z'),
    arrivalAtUtc: new Date('2026-12-27T16:00:00.000Z'),
    departureDateKey: '2026-12-27',
    cabinInventory: [cabin(CabinCategory.ECONOMY, '210.00', 8, 20)],
    ...overrides,
  });
}

function passenger(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Khaled Elshitany',
    dateOfBirth: '2004-03-10',
    passengerType: PassengerType.ADULT,
    documentNumber: 'A12345678',
    ...overrides,
  };
}

const adult = passenger();
const child = passenger({
  fullName: 'Child',
  dateOfBirth: '2018-01-01',
  passengerType: PassengerType.CHILD,
});
const infant = passenger({
  fullName: 'Baby',
  dateOfBirth: '2025-08-01',
  passengerType: PassengerType.INFANT,
});

function request(overrides: Record<string, unknown> = {}) {
  return {
    tripType: TripType.ONE_WAY,
    outbound: {
      flightId: OUTBOUND_ID.toString(),
      cabin: CabinCategory.ECONOMY,
    },
    passengers: [adult],
    ...overrides,
  } as unknown as FlightBookingRequestDto;
}

function roundTrip(overrides: Record<string, unknown> = {}) {
  return request({
    tripType: TripType.ROUND_TRIP,
    inbound: { flightId: INBOUND_ID.toString(), cabin: CabinCategory.ECONOMY },
    ...overrides,
  });
}

// A query stand-in: session(), lean() and exec() resolve to the given result.
function query<R>(result: R) {
  const chain = {
    session: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

function setup(
  options: {
    flights?: Flight[];
    airlineStatus?: AirlineStatus | null;
    policy?: Partial<PolicySnapshot>;
  } = {},
) {
  const flights = options.flights ?? [outboundFlight(), inboundFlight()];
  const airlineStatus =
    options.airlineStatus === undefined
      ? AirlineStatus.ACTIVE
      : options.airlineStatus;
  const flightModel = {
    findById: jest.fn((id: string) =>
      query(flights.find((f) => f._id.toString() === id) ?? null),
    ),
  };
  const airlineModel = {
    findById: jest.fn(() =>
      query(airlineStatus ? { status: airlineStatus } : null),
    ),
  };
  const referenceData = {
    getAirportOrThrow: jest.fn((id: string) =>
      Promise.resolve({ id, timeZone: ZONES[id] }),
    ),
  };
  const policies = new FlightBookingPolicyReader();
  if (options.policy) {
    const policy = options.policy;
    jest.spyOn(policies, 'snapshotFor').mockImplementation((airlineId) =>
      Promise.resolve({
        airlineId,
        version: 0,
        extraBagPrice: null,
        maxExtraBagsPerPassenger: null,
        cancellationTiers: [],
        ...policy,
      }),
    );
  }
  const service = new FlightBookingsService(
    flightModel as unknown as Model<Flight>,
    airlineModel as unknown as Model<Airline>,
    referenceData as unknown as ReferenceDataService,
    policies,
  );
  return { service, flightModel, policies };
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

describe('FlightBookingsService.summarize (FLT-19, FLT-21)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('prices a one-way trip for two adults and an infant', async () => {
    const { service } = setup();
    const summary = await service.summarize(
      request({ passengers: [adult, adult, infant] }),
    );

    expect(summary.segments).toEqual([
      {
        flightId: OUTBOUND_ID.toString(),
        airlineId: AIRLINE_ID.toString(),
        flightNumber: 'MS910',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureLocalTime: '2026-12-20T08:30:00+02:00',
        arrivalLocalTime: '2026-12-20T14:30:00+04:00',
        departureAtUtc: '2026-12-20T06:30:00.000Z',
        arrivalAtUtc: '2026-12-20T10:30:00.000Z',
        durationMinutes: 240,
        cabin: CabinCategory.ECONOMY,
        pricePerSeat: '199.99',
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
    ]);
    expect(summary.passengers.map((p) => p.fare)).toEqual([
      '199.99',
      '199.99',
      '20.00',
    ]);
    expect(summary.passengers[0]).toEqual({
      fullName: 'Khaled Elshitany',
      dateOfBirth: '2004-03-10',
      passengerType: PassengerType.ADULT,
      documentNumber: '•••••5678',
      fare: '199.99',
      extraBags: null,
    });
    expect(summary.price).toEqual({
      subtotal: '419.98',
      baggageTotal: '0.00',
      total: '419.98',
      currency: 'USD',
    });
  });

  it('shows the policy the booking would be made under', async () => {
    const { service } = setup();
    const summary = await service.summarize(request());

    // No airline has a policy until the FLT-08 PR is merged.
    expect(summary.policy).toEqual({
      airlineId: AIRLINE_ID.toString(),
      version: 0,
      extraBagPrice: null,
      maxExtraBagsPerPassenger: null,
      cancellationTiers: [],
    });
  });

  it('adds both segments of a round trip', async () => {
    const { service } = setup();
    const summary = await service.summarize(roundTrip());

    expect(summary.segments.map((s) => s.flightNumber)).toEqual([
      'MS910',
      'MS911',
    ]);
    expect(summary.segments[1].departureLocalTime).toBe(
      '2026-12-27T16:00:00+04:00',
    );
    expect(summary.price.total).toBe('409.99');
  });

  it('asks for the policy of the outbound airline', async () => {
    const { service, policies } = setup();
    const snapshotFor = jest.spyOn(policies, 'snapshotFor');
    await service.summarize(roundTrip());

    expect(snapshotFor).toHaveBeenCalledTimes(1);
    expect(snapshotFor).toHaveBeenCalledWith(AIRLINE_ID);
  });

  describe('the flights', () => {
    it('answers 404 FLIGHT_NOT_FOUND on the field of the missing flight', async () => {
      const { service } = setup({ flights: [outboundFlight()] });
      const error = await failure(service.summarize(roundTrip()));

      expect(error.getStatus()).toBe(404);
      expect(error.getResponse()).toEqual({
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight not found',
        errors: [
          { field: 'inbound.flightId', messages: ['no flight has this id'] },
        ],
      });
    });

    it.each([
      ['cancelled', { status: FlightStatus.CANCELLED }, AirlineStatus.ACTIVE],
      [
        'departed',
        { departureAtUtc: new Date('2026-11-18T11:00:00.000Z') },
        AirlineStatus.ACTIVE,
      ],
      ['of a deactivated airline (ACC-15)', {}, AirlineStatus.DEACTIVATED],
      ['of a missing airline', {}, null],
    ])(
      'answers 409 FLIGHT_NOT_BOOKABLE for a flight that is %s',
      async (_case, overrides, airlineStatus) => {
        const { service } = setup({
          flights: [outboundFlight(overrides)],
          airlineStatus,
        });
        const error = await failure(service.summarize(request()));

        expect(error.getStatus()).toBe(409);
        expect(error.getResponse()).toMatchObject({
          code: 'FLIGHT_NOT_BOOKABLE',
          errors: [{ field: 'outbound.flightId' }],
        });
      },
    );

    it('answers 400 CABIN_NOT_OFFERED on the cabin field', async () => {
      const { service } = setup();
      const error = await failure(
        service.summarize(
          request({
            outbound: {
              flightId: OUTBOUND_ID.toString(),
              cabin: CabinCategory.FIRST,
            },
          }),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toEqual({
        code: 'CABIN_NOT_OFFERED',
        message: 'This flight has no FIRST cabin',
        errors: [
          {
            field: 'outbound.cabin',
            messages: ['This flight has no FIRST cabin'],
          },
        ],
      });
    });

    it('needs a seat for every adult and child, but none for an infant', async () => {
      const { service } = setup();
      const business = {
        flightId: OUTBOUND_ID.toString(),
        cabin: CabinCategory.BUSINESS,
      };
      // BUSINESS has 2 free seats.
      await expect(
        service.summarize(
          request({ outbound: business, passengers: [adult, adult, infant] }),
        ),
      ).resolves.toBeDefined();

      const error = await failure(
        service.summarize(
          request({ outbound: business, passengers: [adult, adult, child] }),
        ),
      );
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        code: 'SEAT_UNAVAILABLE',
        message: 'Only 2 seats left in BUSINESS',
      });
    });
  });

  describe('a round trip', () => {
    it('must fly back between the same two airports', async () => {
      const { service } = setup({
        flights: [outboundFlight(), inboundFlight({ arrivalAirportId: 'JFK' })],
      });
      const error = await failure(service.summarize(roundTrip()));

      expect(error.getResponse()).toEqual({
        code: 'ROUND_TRIP_ROUTE_MISMATCH',
        message: 'inbound must fly from DXB to CAI',
        errors: [
          {
            field: 'inbound.flightId',
            messages: ['inbound must fly from DXB to CAI'],
          },
        ],
      });
    });

    it('must leave after the outbound flight lands', async () => {
      const { service } = setup({
        flights: [
          outboundFlight(),
          // Leaves Dubai at 10:00 UTC; the outbound lands at 10:30 UTC.
          inboundFlight({ departureAtUtc: new Date('2026-12-20T10:00:00Z') }),
        ],
      });
      const error = await failure(service.summarize(roundTrip()));

      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toMatchObject({
        code: 'RETURN_BEFORE_ARRIVAL',
      });
    });
  });

  it('lists every passenger whose type does not match the date of birth', async () => {
    const { service } = setup();
    const error = await failure(
      service.summarize(
        request({
          passengers: [
            adult,
            passenger({ dateOfBirth: '2018-01-01' }),
            passenger({
              dateOfBirth: '2026-12-21',
              passengerType: PassengerType.INFANT,
            }),
          ],
        }),
      ),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: 'PASSENGER_TYPE_MISMATCH',
      message:
        'Passenger types must match their dates of birth on the departure date',
      errors: [
        {
          field: 'passengers.1.passengerType',
          messages: [
            'passengerType must be CHILD for someone born on 2018-01-01 (age on 2026-12-20)',
          ],
        },
        {
          field: 'passengers.2.dateOfBirth',
          messages: [
            'dateOfBirth must not be after the departure date 2026-12-20',
          ],
        },
      ],
    });
  });

  describe('extra bags (FLT-08, FLT-19)', () => {
    const withBags = (count: number, weightKg: number) =>
      passenger({ extraBags: { count, weightKg } });

    it('refuses extra bags when the airline sells none', async () => {
      const { service } = setup();
      const error = await failure(
        service.summarize(request({ passengers: [withBags(1, 20)] })),
      );

      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toEqual({
        code: 'EXTRA_BAGS_NOT_ALLOWED',
        message:
          "Extra bags must fit the airline's policy and the cabin's bag weight",
        errors: [
          {
            field: 'passengers.0.extraBags',
            messages: ['this airline does not sell extra bags'],
          },
        ],
      });
    });

    const policy = {
      version: 2,
      extraBagPrice: Types.Decimal128.fromString('25.00'),
      maxExtraBagsPerPassenger: 2,
    };

    it("checks the airline's limit and the lighter cabin's bag weight", async () => {
      const { service } = setup({ policy });
      // The return cabin allows 20 kg, the outbound 23 kg.
      const error = await failure(
        service.summarize(roundTrip({ passengers: [withBags(3, 21)] })),
      );

      expect(error.getResponse()).toMatchObject({
        code: 'EXTRA_BAGS_NOT_ALLOWED',
        errors: [
          {
            field: 'passengers.0.extraBags.count',
            messages: [
              "count must not be more than 2, the airline's limit per passenger",
            ],
          },
          {
            field: 'passengers.0.extraBags.weightKg',
            messages: [
              "weightKg must not be more than 20, the cabin's bag weight",
            ],
          },
        ],
      });
    });

    it('charges each extra bag once per segment', async () => {
      const { service } = setup({ policy });
      const summary = await service.summarize(
        roundTrip({ passengers: [withBags(2, 20), infant] }),
      );

      // 2 bags x 25.00 x 2 segments.
      expect(summary.passengers[0].extraBags).toEqual({
        count: 2,
        weightKg: 20,
        fee: '100.00',
      });
      expect(summary.price).toEqual({
        subtotal: '450.99',
        baggageTotal: '100.00',
        total: '550.99',
        currency: 'USD',
      });
      expect(summary.policy).toMatchObject({
        version: 2,
        extraBagPrice: '25.00',
        maxExtraBagsPerPassenger: 2,
      });
    });
  });
});
