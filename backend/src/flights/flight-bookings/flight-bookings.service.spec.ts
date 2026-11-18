import { ConflictException, HttpException } from '@nestjs/common';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import {
  BookingStatus,
  FlightBooking,
  PassengerType,
  PolicySnapshot,
  TripType,
} from '../schemas/flight-booking.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import type { FlightBookingRequestDto } from './dto/flight-booking-request.dto';
import type { AirlinePoliciesService } from '../policies/airline-policies.service';
import type { SeatInventoryService } from '../seat-inventory/seat-inventory.service';
import { FlightBookingPolicyReader } from './flight-booking-policy.reader';
import { FlightBookingsService } from './flight-bookings.service';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const AIRLINE_ID = new Types.ObjectId();
const OUTBOUND_ID = new Types.ObjectId();
const INBOUND_ID = new Types.ObjectId();
const BOOKING_ID = new Types.ObjectId();
const USER: AuthenticatedUser = {
  userId: new Types.ObjectId().toString(),
  role: Role.USER,
  sessionId: '6720f1c2a1b2c3d4e5f60799',
};
// Stands in for the transaction's session; only its identity matters here.
const SESSION = { id: 'test-session' } as unknown as ClientSession;

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

// A query stand-in: session(), lean() and exec() resolve to the given result. Every
// session() call is recorded, to prove the reads run inside the hold's transaction.
const sessions: unknown[] = [];
function query<R>(result: R) {
  const chain = {
    session: (session: unknown) => {
      sessions.push(session);
      return chain;
    },
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
    stored?: FlightBooking;
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
    // The names the e-ticket prints (FLT-23).
    find: jest.fn(() => query([{ _id: AIRLINE_ID, name: 'EgyptAir' }])),
  };
  const referenceData = {
    getAirportOrThrow: jest.fn((id: string) =>
      Promise.resolve({ id, name: `${id} airport`, timeZone: ZONES[id] }),
    ),
  };
  // No airline policy by default: tests that need one override snapshotFor below.
  const policies = new FlightBookingPolicyReader({
    getForAirline: () => Promise.resolve(null),
  } as unknown as AirlinePoliciesService);
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
  const bookingModel = {
    findOne: jest.fn(() => query(options.stored ?? null)),
    create: jest.fn((docs: Partial<FlightBooking>[]) =>
      Promise.resolve(
        docs.map((doc) => ({
          toObject: () => ({ _id: BOOKING_ID, createdAt: NOW, ...doc }),
        })),
      ),
    ),
  };
  // Runs the callback once with the stand-in session, as a committed transaction would.
  const connection = {
    transaction: jest.fn((fn: (session: ClientSession) => Promise<unknown>) =>
      fn(SESSION),
    ),
  };
  const seatInventory = { hold: jest.fn(() => Promise.resolve()) };
  sessions.length = 0;
  const service = new FlightBookingsService(
    flightModel as unknown as Model<Flight>,
    airlineModel as unknown as Model<Airline>,
    bookingModel as unknown as Model<FlightBooking>,
    connection as unknown as Connection,
    seatInventory as unknown as SeatInventoryService,
    referenceData as unknown as ReferenceDataService,
    policies,
  );
  return { service, flightModel, policies, bookingModel, seatInventory };
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

describe('FlightBookingsService.hold (FLT-22)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const bagPolicy = {
    version: 2,
    extraBagPrice: Types.Decimal128.fromString('25.00'),
    maxExtraBagsPerPassenger: 2,
  };

  it('holds a seat per adult and child on every segment, inside the transaction', async () => {
    const { service, seatInventory } = setup();
    await service.hold(roundTrip({ passengers: [adult, adult, infant] }), USER);

    expect(seatInventory.hold.mock.calls).toEqual([
      [
        { flightId: OUTBOUND_ID, category: CabinCategory.ECONOMY, seats: 2 },
        SESSION,
      ],
      [
        { flightId: INBOUND_ID, category: CabinCategory.ECONOMY, seats: 2 },
        SESSION,
      ],
    ]);
    // Every flight and airline read used the transaction's session.
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session === SESSION)).toBe(true);
  });

  it('stores the booking with its snapshots for 10 minutes and returns it', async () => {
    const { service, bookingModel } = setup({ policy: bagPolicy });
    const booking = await service.hold(
      request({
        passengers: [
          passenger({ extraBags: { count: 1, weightKg: 20 } }),
          infant,
        ],
      }),
      USER,
    );

    const [docs, options] = bookingModel.create.mock.calls[0] as unknown as [
      Partial<FlightBooking>[],
      { session: ClientSession },
    ];
    expect(options).toEqual({ session: SESSION });
    const doc = docs[0];
    expect(doc.userId?.toString()).toBe(USER.userId);
    expect(doc.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(doc.holdExpiresAt).toEqual(new Date('2026-11-18T12:10:00.000Z'));
    expect(doc.segments?.[0]).toMatchObject({
      flightId: OUTBOUND_ID,
      airlineId: AIRLINE_ID,
      cabinCategory: CabinCategory.ECONOMY,
      seatsRequired: 1,
    });
    expect(doc.segments?.[0].cabinPrice.toString()).toBe('199.99');
    expect(
      doc.passengers?.map((p) => [
        p.passengerType,
        p.seatRequired,
        p.fareAmount.toString(),
      ]),
    ).toEqual([
      [PassengerType.ADULT, true, '199.99'],
      [PassengerType.INFANT, false, '20.00'],
    ]);
    expect(doc.baggage).toHaveLength(1);
    expect(doc.baggage?.[0].passengerId).toBe(doc.passengers?.[0]._id);
    expect(doc.baggage?.[0].fee.toString()).toBe('25.00');
    expect(doc.priceSnapshot?.total.toString()).toBe('244.99');
    expect(doc.policySnapshot).toMatchObject({
      airlineId: AIRLINE_ID,
      version: 2,
    });

    expect(booking).toMatchObject({
      id: BOOKING_ID.toString(),
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: '2026-11-18T12:10:00.000Z',
      bookingReference: null,
      createdAt: NOW.toISOString(),
      price: {
        subtotal: '219.99',
        baggageTotal: '25.00',
        total: '244.99',
        currency: 'USD',
      },
    });
    expect(booking.passengers[0]).toMatchObject({
      documentNumber: '•••••5678',
      extraBags: { count: 1, weightKg: 20, fee: '25.00' },
    });
    expect(booking.segments[0].departureLocalTime).toBe(
      '2026-12-20T08:30:00+02:00',
    );
  });

  it('holds and stores nothing when the request does not pass the checks', async () => {
    const { service, seatInventory, bookingModel } = setup();
    const error = await failure(
      service.hold(
        request({ passengers: [passenger({ dateOfBirth: '2018-01-01' })] }),
        USER,
      ),
    );

    expect(error.getResponse()).toMatchObject({
      code: 'PASSENGER_TYPE_MISMATCH',
    });
    expect(seatInventory.hold).not.toHaveBeenCalled();
    expect(bookingModel.create).not.toHaveBeenCalled();
  });

  it('stores nothing when a segment cannot be held: the transaction aborts', async () => {
    const { service, seatInventory, bookingModel } = setup();
    seatInventory.hold
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() =>
        Promise.reject(
          new ConflictException({
            code: 'SEAT_UNAVAILABLE',
            message: 'No seats left in ECONOMY',
          }),
        ),
      );
    const error = await failure(service.hold(roundTrip(), USER));

    expect(error.getStatus()).toBe(409);
    expect(seatInventory.hold).toHaveBeenCalledTimes(2);
    expect(bookingModel.create).not.toHaveBeenCalled();
  });
});

describe('FlightBookingsService.findOwned (FLT-22, ACC-11)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // The document hold() stores, as the database gives it back.
  async function storedBooking(): Promise<FlightBooking> {
    const { service, bookingModel } = setup();
    await service.hold(request({ passengers: [adult, infant] }), USER);
    const [docs] = bookingModel.create.mock.calls[0] as unknown as [
      Partial<FlightBooking>[],
    ];
    return { _id: BOOKING_ID, createdAt: NOW, ...docs[0] } as FlightBooking;
  }

  it("returns the caller's booking, looked up with the owner in the filter", async () => {
    const stored = await storedBooking();
    const { service, bookingModel } = setup({ stored });

    const booking = await service.findOwned(BOOKING_ID.toString(), USER);

    expect(bookingModel.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID.toString(),
      userId: USER.userId,
    });
    expect(booking).toMatchObject({
      id: BOOKING_ID.toString(),
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: '2026-11-18T12:10:00.000Z',
      bookingReference: null,
      price: { total: '219.99', currency: 'USD' },
    });
    expect(booking.passengers.map((p) => p.documentNumber)).toEqual([
      '•••••5678',
      '•••••5678',
    ]);
  });

  it("answers the same 404 for a missing booking and another account's", async () => {
    const { service } = setup();

    const error = await failure(service.findOwned(BOOKING_ID.toString(), USER));

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      code: 'BOOKING_NOT_FOUND',
      message: 'Booking not found',
    });
  });

  it('answers 404 for a malformed id without querying', async () => {
    const { service, bookingModel } = setup();

    const error = await failure(service.findOwned('not-an-id', USER));

    expect(error.getStatus()).toBe(404);
    expect(bookingModel.findOne).not.toHaveBeenCalled();
  });
});

describe('FlightBookingsService.eTicket (FLT-23)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // The document hold() stores, then changed to the given status.
  async function stored(
    status: BookingStatus,
    bookingReference?: string,
  ): Promise<FlightBooking> {
    const { service, bookingModel } = setup();
    await service.hold(request({ passengers: [adult, infant] }), USER);
    const [docs] = bookingModel.create.mock.calls[0] as unknown as [
      Partial<FlightBooking>[],
    ];
    return {
      _id: BOOKING_ID,
      createdAt: NOW,
      ...docs[0],
      status,
      bookingReference,
    } as FlightBooking;
  }

  it('gives the owner a PDF named after the booking reference', async () => {
    const { service, bookingModel } = setup({
      stored: await stored(BookingStatus.CONFIRMED, 'K7Q2PX'),
    });

    const ticket = await service.eTicket(BOOKING_ID.toString(), USER);

    expect(bookingModel.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID.toString(),
      userId: USER.userId,
    });
    expect(ticket.filename).toBe('e-ticket-K7Q2PX.pdf');
    expect(ticket.content.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('still gives the ticket of a COMPLETED booking', async () => {
    const { service } = setup({
      stored: await stored(BookingStatus.COMPLETED, 'K7Q2PX'),
    });

    await expect(
      service.eTicket(BOOKING_ID.toString(), USER),
    ).resolves.toMatchObject({ filename: 'e-ticket-K7Q2PX.pdf' });
  });

  it.each([
    BookingStatus.PENDING_PAYMENT,
    BookingStatus.EXPIRED,
    BookingStatus.CANCELLED,
  ])('refuses a %s booking with 409 TICKET_NOT_AVAILABLE', async (status) => {
    const { service } = setup({ stored: await stored(status) });

    const error = await failure(service.eTicket(BOOKING_ID.toString(), USER));

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      code: 'TICKET_NOT_AVAILABLE',
      message:
        'The e-ticket is available once the booking is paid and confirmed',
    });
  });

  it("answers 404 for another account's booking, as for a missing one", async () => {
    const { service } = setup();

    const error = await failure(service.eTicket(BOOKING_ID.toString(), USER));

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      code: 'BOOKING_NOT_FOUND',
      message: 'Booking not found',
    });
  });
});
