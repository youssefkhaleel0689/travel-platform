import { BadRequestException, HttpException } from '@nestjs/common';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { AirportDto } from '../../common/reference-data/dto/airport.dto';
import { BookingStatus } from '../../common/bookings/booking-status';
import type { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { NotificationType } from '../../notifications/notification-type.enum';
import type { NotificationsService } from '../../notifications/notifications.service';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { FlightBooking } from '../schemas/flight-booking.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import { FlightsService } from './flights.service';

const AIRLINE_ID = new Types.ObjectId();
const FLIGHT_ID = new Types.ObjectId();
const MODERATOR_ID = new Types.ObjectId().toString();
const SESSION_ID = new Types.ObjectId().toString();
// The server clock in every test.
const NOW = new Date('2026-11-12T10:00:00.000Z');
// What the fake connection hands to the work it runs in a transaction.
const SESSION = { id: 'test-session' } as unknown as ClientSession;

const moderator: AuthenticatedUser = {
  userId: MODERATOR_ID,
  role: Role.AIRLINE_MODERATOR,
  sessionId: SESSION_ID,
};

const AIRPORTS: Record<string, AirportDto> = {
  CAI: {
    id: 'CAI',
    name: 'Cairo International Airport',
    cityId: 'cairo',
    countryId: 'EG',
    timeZone: 'Africa/Cairo',
  },
  DXB: {
    id: 'DXB',
    name: 'Dubai International Airport',
    cityId: 'dubai',
    countryId: 'AE',
    timeZone: 'Asia/Dubai',
  },
  LHR: {
    id: 'LHR',
    name: 'London Heathrow Airport',
    cityId: 'london',
    countryId: 'GB',
    timeZone: 'Europe/London',
  },
};

// Cairo is UTC+2 in December and Dubai is UTC+4, so 08:30 in Cairo is 06:30Z and 14:30 in
// Dubai is 10:30Z: a 4 hour flight.
const VALID = {
  flightNumber: 'MS777',
  departureAirportId: 'CAI',
  arrivalAirportId: 'DXB',
  departureLocalInput: '2026-12-20T08:30',
  arrivalLocalInput: '2026-12-20T14:30',
};

// A query stand-in: select(), lean() and exec() resolve to the given result.
function query<R>(result: R) {
  const chain = {
    select: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

// Fake models and reference data; the casts are done only here.
function setup(
  options: {
    assignedTo?: Types.ObjectId | null;
    airlineStatus?: AirlineStatus | null;
    createError?: unknown;
    current?: Flight | null;
    updated?: Flight | null;
    updateError?: unknown;
    confirmedBookings?: { _id: Types.ObjectId; userId: Types.ObjectId }[];
    moveTimesError?: unknown;
  } = {},
) {
  const assignedTo =
    options.assignedTo === undefined ? AIRLINE_ID : options.assignedTo;

  const assignmentModel = {
    findOne: jest.fn(() =>
      query(
        assignedTo
          ? { moderatorId: MODERATOR_ID, airlineId: assignedTo }
          : null,
      ),
    ),
  };
  // null stands for an airline document that does not exist.
  const airlineStatus =
    options.airlineStatus === undefined
      ? AirlineStatus.ACTIVE
      : options.airlineStatus;
  const airlineModel = {
    findById: jest.fn(() => ({
      select: () => query(airlineStatus ? { status: airlineStatus } : null),
    })),
  };
  const flightModel = {
    findOne: jest.fn(() =>
      query(options.current === undefined ? null : options.current),
    ),
    findOneAndUpdate: jest.fn(() => {
      if (options.updateError) {
        return {
          lean: () => ({
            exec: () => Promise.reject(options.updateError as Error),
          }),
        };
      }
      return query(options.updated === undefined ? null : options.updated);
    }),
    create: jest.fn((doc: Partial<Flight>) => {
      if (options.createError) {
        return Promise.reject(options.createError as Error);
      }
      return Promise.resolve({
        toObject: () => ({
          ...doc,
          _id: FLIGHT_ID,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      });
    }),
  };
  const referenceData = {
    getAirportOrThrow: jest.fn((id: string) => {
      const airport = AIRPORTS[id];
      return airport
        ? Promise.resolve(airport)
        : Promise.reject(
            new BadRequestException({
              code: 'UNKNOWN_AIRPORT',
              message: `Unknown airport: ${id}`,
            }),
          );
    }),
  };
  const flightBookingModel = {
    find: jest.fn(() => query(options.confirmedBookings ?? [])),
    updateMany: jest.fn(() => ({
      exec: () =>
        options.moveTimesError
          ? Promise.reject(options.moveTimesError as Error)
          : Promise.resolve({ modifiedCount: 1 }),
    })),
  };
  const notifications = {
    notifyMany: jest.fn(() => Promise.resolve()),
  };
  // Runs the callback with a stand-in session, the way Connection.transaction would; a
  // rejection inside it rejects the whole transaction.
  const connection = {
    transaction: jest.fn(
      <T>(work: (session: ClientSession) => Promise<T>): Promise<T> =>
        work(SESSION),
    ),
  };
  const service = new FlightsService(
    flightModel as unknown as Model<Flight>,
    assignmentModel as unknown as Model<AirlineModeratorAssignment>,
    airlineModel as unknown as Model<Airline>,
    referenceData as unknown as ReferenceDataService,
    flightBookingModel as unknown as Model<FlightBooking>,
    notifications as unknown as NotificationsService,
    connection as unknown as Connection,
  );
  return {
    service,
    flightModel,
    assignmentModel,
    airlineModel,
    referenceData,
    flightBookingModel,
    notifications,
    connection,
  };
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

function codeOf(error: HttpException): unknown {
  return (error.getResponse() as { code?: unknown }).code;
}

describe('FlightsService.create (FLT-03)', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a SCHEDULED flight with UTC instants, the local date key and no cabins', async () => {
    const { service, flightModel } = setup();
    const result = await service.create(VALID, moderator);

    expect(flightModel.create).toHaveBeenCalledWith({
      airlineId: AIRLINE_ID,
      flightNumber: 'MS777',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2026-12-20T08:30',
      arrivalLocalInput: '2026-12-20T14:30',
      departureAtUtc: new Date('2026-12-20T06:30:00.000Z'),
      arrivalAtUtc: new Date('2026-12-20T10:30:00.000Z'),
      departureDateKey: '2026-12-20',
      status: FlightStatus.SCHEDULED,
      cabinInventory: [],
    });
    expect(result).toEqual({
      id: FLIGHT_ID.toString(),
      airlineId: AIRLINE_ID.toString(),
      flightNumber: 'MS777',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2026-12-20T08:30',
      arrivalLocalInput: '2026-12-20T14:30',
      departureAtUtc: '2026-12-20T06:30:00.000Z',
      arrivalAtUtc: '2026-12-20T10:30:00.000Z',
      departureDateKey: '2026-12-20',
      durationMinutes: 240,
      status: 'SCHEDULED',
      cabinInventory: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it('takes the airline from the assignment, looked up by the logged-in moderator', async () => {
    const { service, assignmentModel, flightModel } = setup();
    await service.create(VALID, moderator);
    expect(assignmentModel.findOne).toHaveBeenCalledWith({
      moderatorId: new Types.ObjectId(MODERATOR_ID),
    });
    expect(flightModel.create.mock.calls[0][0].airlineId).toEqual(AIRLINE_ID);
  });

  it('builds departureDateKey from the DEPARTURE airport clock, not from the UTC date', async () => {
    const { service, flightModel } = setup();
    // 00:30 in Cairo on 21 Dec is 22:30Z on 20 Dec: the UTC date differs from the local one.
    await service.create(
      {
        ...VALID,
        departureLocalInput: '2026-12-21T00:30',
        arrivalLocalInput: '2026-12-21T06:30',
      },
      moderator,
    );
    const stored = flightModel.create.mock.calls[0][0];
    expect(stored.departureAtUtc).toEqual(new Date('2026-12-20T22:30:00.000Z'));
    expect(stored.departureDateKey).toBe('2026-12-21');
  });

  it('rejects a moderator without an assignment with 403 NO_AIRLINE_ASSIGNED and does nothing else', async () => {
    const { service, flightModel, referenceData } = setup({ assignedTo: null });
    const error = await failure(service.create(VALID, moderator));
    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('NO_AIRLINE_ASSIGNED');
    expect(referenceData.getAirportOrThrow).not.toHaveBeenCalled();
    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('rejects a DEACTIVATED airline with 403 AIRLINE_DEACTIVATED and does nothing else (ACC-15)', async () => {
    const { service, flightModel, airlineModel, referenceData } = setup({
      airlineStatus: AirlineStatus.DEACTIVATED,
    });
    const error = await failure(service.create(VALID, moderator));
    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('AIRLINE_DEACTIVATED');
    expect(airlineModel.findById).toHaveBeenCalledWith(AIRLINE_ID);
    expect(referenceData.getAirportOrThrow).not.toHaveBeenCalled();
    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('creates the flight for an ACTIVE airline', async () => {
    const { service, flightModel, airlineModel } = setup({
      airlineStatus: AirlineStatus.ACTIVE,
    });
    await service.create(VALID, moderator);
    expect(airlineModel.findById).toHaveBeenCalledWith(AIRLINE_ID);
    expect(flightModel.create).toHaveBeenCalledTimes(1);
  });

  it('rejects identical airports with 400 SAME_AIRPORTS before any lookup', async () => {
    const { service, flightModel, referenceData } = setup();
    const error = await failure(
      service.create({ ...VALID, arrivalAirportId: 'CAI' }, moderator),
    );
    expect(error.getStatus()).toBe(400);
    expect(codeOf(error)).toBe('SAME_AIRPORTS');
    expect(error.getResponse()).toMatchObject({
      errors: [{ field: 'arrivalAirportId' }],
    });
    expect(referenceData.getAirportOrThrow).not.toHaveBeenCalled();
    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it.each([
    ['departureAirportId', 'XXX'],
    ['arrivalAirportId', 'YYY'],
  ])('rejects an unknown %s with 400 UNKNOWN_AIRPORT', async (field, code) => {
    const { service, flightModel } = setup();
    const error = await failure(
      service.create({ ...VALID, [field]: code }, moderator),
    );
    expect(error.getStatus()).toBe(400);
    expect(codeOf(error)).toBe('UNKNOWN_AIRPORT');
    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('rejects a departure in the past with 400 DEPARTURE_IN_PAST', async () => {
    const { service, flightModel } = setup();
    // 2026-11-12T10:00Z is 12:00 in Cairo; 11:00 the same day is already over.
    const error = await failure(
      service.create(
        {
          ...VALID,
          departureLocalInput: '2026-11-12T11:00',
          arrivalLocalInput: '2026-11-12T17:00',
        },
        moderator,
      ),
    );
    expect(error.getStatus()).toBe(400);
    expect(codeOf(error)).toBe('DEPARTURE_IN_PAST');
    expect(error.getResponse()).toMatchObject({
      errors: [{ field: 'departureLocalInput' }],
    });
    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('rejects a departure at exactly the current instant', async () => {
    const { service } = setup();
    // 12:00 in Cairo is 10:00Z, which is NOW.
    const error = await failure(
      service.create(
        {
          ...VALID,
          departureLocalInput: '2026-11-12T12:00',
          arrivalLocalInput: '2026-11-12T18:00',
        },
        moderator,
      ),
    );
    expect(codeOf(error)).toBe('DEPARTURE_IN_PAST');
  });

  it('accepts a departure one minute in the future', async () => {
    const { service, flightModel } = setup();
    await service.create(
      {
        ...VALID,
        departureLocalInput: '2026-11-12T12:01',
        arrivalLocalInput: '2026-11-12T18:00',
      },
      moderator,
    );
    expect(flightModel.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an arrival equal to the departure in UTC with 400 ARRIVAL_NOT_AFTER_DEPARTURE', async () => {
    const { service, flightModel } = setup();
    // 08:30 Cairo = 06:30Z and 10:30 Dubai = 06:30Z.
    const error = await failure(
      service.create(
        { ...VALID, arrivalLocalInput: '2026-12-20T10:30' },
        moderator,
      ),
    );
    expect(error.getStatus()).toBe(400);
    expect(codeOf(error)).toBe('ARRIVAL_NOT_AFTER_DEPARTURE');
    expect(error.getResponse()).toMatchObject({
      errors: [{ field: 'arrivalLocalInput' }],
    });
    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('compares in UTC: a later local clock reading can still be an earlier instant', async () => {
    const { service } = setup();
    // Dubai 10:00 = 06:00Z, Cairo 07:00 = 05:00Z. The arrival reads later but is earlier.
    const error = await failure(
      service.create(
        {
          flightNumber: 'MS778',
          departureAirportId: 'DXB',
          arrivalAirportId: 'CAI',
          departureLocalInput: '2026-12-20T10:00',
          arrivalLocalInput: '2026-12-20T07:00',
        },
        moderator,
      ),
    );
    expect(codeOf(error)).toBe('ARRIVAL_NOT_AFTER_DEPARTURE');
  });

  it('accepts a flight whose arrival is on the next calendar day', async () => {
    const { service, flightModel } = setup();
    await service.create(
      {
        ...VALID,
        departureLocalInput: '2026-12-20T23:30',
        arrivalLocalInput: '2026-12-21T05:30',
      },
      moderator,
    );
    const stored = flightModel.create.mock.calls[0][0];
    expect(stored.departureDateKey).toBe('2026-12-20');
    expect(stored.arrivalAtUtc).toEqual(new Date('2026-12-21T01:30:00.000Z'));
  });

  it('rejects a local time skipped by a clock change with 400 NONEXISTENT_LOCAL_TIME', async () => {
    const { service, flightModel } = setup();
    // Egypt moves its clocks from 00:00 to 01:00 on Friday 30 April 2027.
    const error = await failure(
      service.create(
        {
          ...VALID,
          departureLocalInput: '2027-04-30T00:30',
          arrivalLocalInput: '2027-04-30T08:00',
        },
        moderator,
      ),
    );
    expect(error.getStatus()).toBe(400);
    expect(codeOf(error)).toBe('NONEXISTENT_LOCAL_TIME');
    expect(flightModel.create).not.toHaveBeenCalled();
  });

  it('turns a duplicate-key error into 409 FLIGHT_ALREADY_EXISTS', async () => {
    const { service } = setup({
      createError: Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      }),
    });
    const error = await failure(service.create(VALID, moderator));
    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('FLIGHT_ALREADY_EXISTS');
    expect(error.getResponse()).toMatchObject({
      errors: [{ field: 'flightNumber' }],
    });
  });

  it('does not hide other database errors', async () => {
    const boom = new Error('connection lost');
    const { service } = setup({ createError: boom });
    await expect(service.create(VALID, moderator)).rejects.toBe(boom);
  });
});

// ---------------------------------------------------------------------------------------
// FLT-05: edit a flight
// ---------------------------------------------------------------------------------------

const CURRENT_PLAIN = {
  _id: FLIGHT_ID,
  airlineId: AIRLINE_ID,
  flightNumber: 'MS777',
  departureAirportId: 'CAI',
  arrivalAirportId: 'DXB',
  departureLocalInput: '2026-12-20T08:30',
  arrivalLocalInput: '2026-12-20T14:30',
  departureAtUtc: new Date('2026-12-20T06:30:00.000Z'),
  arrivalAtUtc: new Date('2026-12-20T10:30:00.000Z'),
  departureDateKey: '2026-12-20',
  status: FlightStatus.SCHEDULED,
  cabinInventory: [],
  createdAt: NOW,
  updatedAt: NOW,
};
const CURRENT = CURRENT_PLAIN as unknown as Flight;

type UpdateCall = [
  Record<string, unknown>,
  { $set: Record<string, unknown> },
  { new: boolean; session: ClientSession },
];

const lastUpdate = (flightModel: { findOneAndUpdate: jest.Mock }) =>
  (flightModel.findOneAndUpdate.mock.calls as unknown as UpdateCall[])[0];

const cabinWithSeats = (bookedSeats: number, heldSeats: number) => ({
  category: CabinCategory.ECONOMY,
  totalSeats: 100,
  bookedSeats,
  heldSeats,
  price: Types.Decimal128.fromString('100.00'),
  freeBaggageCount: 1,
  maxBagWeightKg: 23,
});

describe('FlightsService.update (FLT-05)', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('moves the departure: local time to UTC, one conditional update, new date key', async () => {
    const updated = {
      ...CURRENT_PLAIN,
      departureLocalInput: '2026-12-21T01:00',
      arrivalLocalInput: '2026-12-21T07:00',
      departureAtUtc: new Date('2026-12-20T23:00:00.000Z'),
      arrivalAtUtc: new Date('2026-12-21T03:00:00.000Z'),
      departureDateKey: '2026-12-21',
    } as unknown as Flight;
    const { service, flightModel } = setup({ current: CURRENT, updated });
    const result = await service.update(
      FLIGHT_ID.toString(),
      {
        departureLocalInput: '2026-12-21T01:00',
        arrivalLocalInput: '2026-12-21T07:00',
      },
      moderator,
    );
    expect(result.departureDateKey).toBe('2026-12-21');
    const [filter, update] = lastUpdate(flightModel);
    expect(filter).toEqual({
      _id: FLIGHT_ID.toString(),
      airlineId: AIRLINE_ID,
      status: FlightStatus.SCHEDULED,
      departureAtUtc: { $eq: CURRENT.departureAtUtc, $gt: NOW },
      arrivalAtUtc: CURRENT.arrivalAtUtc,
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
    });
    // 01:00 in Cairo (UTC+2) is 23:00Z the day before; 07:00 in Dubai (UTC+4) is 03:00Z.
    expect(update.$set).toEqual({
      departureLocalInput: '2026-12-21T01:00',
      arrivalLocalInput: '2026-12-21T07:00',
      departureAtUtc: new Date('2026-12-20T23:00:00.000Z'),
      arrivalAtUtc: new Date('2026-12-21T03:00:00.000Z'),
      departureDateKey: '2026-12-21',
    });
  });

  it('moves the arrival on the arrival airport clock and keeps the date key', async () => {
    const { service, flightModel } = setup({
      current: CURRENT,
      updated: CURRENT,
    });
    await service.update(
      FLIGHT_ID.toString(),
      { arrivalLocalInput: '2026-12-20T16:00' },
      moderator,
    );
    // 16:00 in Dubai (UTC+4) is 12:00Z.
    expect(lastUpdate(flightModel)[1].$set).toEqual({
      arrivalLocalInput: '2026-12-20T16:00',
      arrivalAtUtc: new Date('2026-12-20T12:00:00.000Z'),
    });
  });

  it('notifies each CONFIRMED booking of the flight when a time changes (GEN-01)', async () => {
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const bookingA = new Types.ObjectId();
    const bookingB = new Types.ObjectId();
    const updated = {
      ...CURRENT_PLAIN,
      departureLocalInput: '2026-12-20T09:15',
      departureAtUtc: new Date('2026-12-20T07:15:00.000Z'),
    } as unknown as Flight;
    const { service, flightBookingModel, notifications } = setup({
      current: CURRENT,
      updated,
      confirmedBookings: [
        { _id: bookingA, userId: userA },
        { _id: bookingB, userId: userB },
      ],
    });
    await service.update(
      FLIGHT_ID.toString(),
      { departureLocalInput: '2026-12-20T09:15' },
      moderator,
    );
    expect(flightBookingModel.find).toHaveBeenCalledWith({
      'segments.flightId': FLIGHT_ID,
      status: BookingStatus.CONFIRMED,
    });
    const calls = notifications.notifyMany.mock.calls as unknown as [
      Record<string, unknown>[],
    ][];
    const sent = calls[0][0];
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      userId: userA,
      type: NotificationType.FLIGHT_SCHEDULE_CHANGED,
      resourceType: 'FLIGHT_BOOKING',
      resourceId: bookingA.toString(),
    });
    expect(String(sent[0].message)).toContain('MS777');
    expect(String(sent[0].message)).toContain('2026-12-20 at 09:15');
  });

  it('does not notify when nothing about the times changes', async () => {
    const { service, notifications, flightModel } = setup({
      current: CURRENT,
      updated: CURRENT,
    });
    // Same text as stored: nothing to write, nothing to tell anybody.
    const result = await service.update(
      FLIGHT_ID.toString(),
      { departureLocalInput: '2026-12-20T08:30' },
      moderator,
    );
    expect(result.id).toBe(FLIGHT_ID.toString());
    expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('moves the times its open bookings copied, in the same transaction as the flight', async () => {
    const updated = {
      ...CURRENT_PLAIN,
      departureLocalInput: '2026-12-20T09:15',
      departureAtUtc: new Date('2026-12-20T07:15:00.000Z'),
    } as unknown as Flight;
    const { service, flightModel, flightBookingModel, connection } = setup({
      current: CURRENT,
      updated,
    });
    await service.update(
      FLIGHT_ID.toString(),
      { departureLocalInput: '2026-12-20T09:15' },
      moderator,
    );
    expect(connection.transaction).toHaveBeenCalledTimes(1);
    expect(lastUpdate(flightModel)[2]).toEqual({ new: true, session: SESSION });
    expect(flightBookingModel.updateMany).toHaveBeenCalledTimes(1);
    expect(flightBookingModel.updateMany).toHaveBeenCalledWith(
      {
        'segments.flightId': FLIGHT_ID,
        status: {
          $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
        },
      },
      {
        $set: {
          'segments.$[segment].departureAtUtc': new Date(
            '2026-12-20T07:15:00.000Z',
          ),
          'segments.$[segment].arrivalAtUtc': CURRENT.arrivalAtUtc,
        },
      },
      { arrayFilters: [{ 'segment.flightId': FLIGHT_ID }], session: SESSION },
    );
  });

  it('leaves the bookings alone when no time changes', async () => {
    const updated = {
      ...CURRENT_PLAIN,
      departureAirportId: 'LHR',
    } as unknown as Flight;
    const { service, flightBookingModel } = setup({
      current: CURRENT,
      updated,
    });
    // 06:30 in London (UTC+0 in December) is the same instant as 08:30 in Cairo.
    await service.update(
      FLIGHT_ID.toString(),
      { departureAirportId: 'LHR', departureLocalInput: '2026-12-20T06:30' },
      moderator,
    );
    expect(flightBookingModel.updateMany).not.toHaveBeenCalled();
  });

  it('leaves the bookings alone when the flight update matched nothing', async () => {
    const { service, flightBookingModel } = setup({
      current: CURRENT,
      updated: null,
    });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { departureLocalInput: '2026-12-20T09:15' },
        moderator,
      ),
    );
    expect(error.getStatus()).toBe(409);
    expect(flightBookingModel.updateMany).not.toHaveBeenCalled();
  });

  it('fails the whole edit, and notifies nobody, when the bookings cannot be moved', async () => {
    const boom = new Error('connection lost');
    const updated = {
      ...CURRENT_PLAIN,
      departureLocalInput: '2026-12-20T09:15',
      departureAtUtc: new Date('2026-12-20T07:15:00.000Z'),
    } as unknown as Flight;
    const { service, notifications } = setup({
      current: CURRENT,
      updated,
      moveTimesError: boom,
    });
    await expect(
      service.update(
        FLIGHT_ID.toString(),
        { departureLocalInput: '2026-12-20T09:15' },
        moderator,
      ),
    ).rejects.toBe(boom);
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('changes the departure airport only with a local time, and guards the seat counters in the filter', async () => {
    const updated = {
      ...CURRENT_PLAIN,
      departureAirportId: 'LHR',
      departureAtUtc: new Date('2026-12-20T08:30:00.000Z'),
    } as unknown as Flight;
    const { service, flightModel } = setup({ current: CURRENT, updated });
    await service.update(
      FLIGHT_ID.toString(),
      { departureAirportId: 'LHR', departureLocalInput: '2026-12-20T08:30' },
      moderator,
    );
    const [filter, update] = lastUpdate(flightModel);
    // London is UTC+0 in December.
    expect(update.$set).toMatchObject({
      departureAirportId: 'LHR',
      departureAtUtc: new Date('2026-12-20T08:30:00.000Z'),
    });
    expect(filter.cabinInventory).toEqual({
      $not: {
        $elemMatch: {
          $or: [{ bookedSeats: { $gt: 0 } }, { heldSeats: { $gt: 0 } }],
        },
      },
    });
  });

  it('is 400 LOCAL_TIME_REQUIRED when an airport changes without its local time', async () => {
    const { service, flightModel } = setup({ current: CURRENT });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { arrivalAirportId: 'LHR' },
        moderator,
      ),
    );
    expect(error.getStatus()).toBe(400);
    expect(codeOf(error)).toBe('LOCAL_TIME_REQUIRED');
    expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('is 400 SAME_AIRPORTS when both ends become the same airport', async () => {
    const { service } = setup({ current: CURRENT });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { arrivalAirportId: 'CAI', arrivalLocalInput: '2026-12-20T12:00' },
        moderator,
      ),
    );
    expect(codeOf(error)).toBe('SAME_AIRPORTS');
  });

  it('is 400 UNKNOWN_AIRPORT for an airport that is not seeded', async () => {
    const { service } = setup({ current: CURRENT });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { arrivalAirportId: 'XXX', arrivalLocalInput: '2026-12-20T12:00' },
        moderator,
      ),
    );
    expect(codeOf(error)).toBe('UNKNOWN_AIRPORT');
  });

  it('is 400 DEPARTURE_IN_PAST for a new departure that is already over', async () => {
    const { service, flightModel } = setup({ current: CURRENT });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { departureLocalInput: '2026-11-10T08:30' },
        moderator,
      ),
    );
    expect(codeOf(error)).toBe('DEPARTURE_IN_PAST');
    expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('is 400 ARRIVAL_NOT_AFTER_DEPARTURE when compared in UTC, not as clock readings', async () => {
    const { service } = setup({ current: CURRENT });
    // 09:00 in Dubai is 05:00Z, before the 06:30Z departure, although 09:00 > 08:30.
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { arrivalLocalInput: '2026-12-20T09:00' },
        moderator,
      ),
    );
    expect(codeOf(error)).toBe('ARRIVAL_NOT_AFTER_DEPARTURE');
  });

  it('is 400 EMPTY_UPDATE when nothing is sent', async () => {
    const { service, flightModel } = setup({ current: CURRENT });
    const error = await failure(
      service.update(FLIGHT_ID.toString(), {}, moderator),
    );
    expect(codeOf(error)).toBe('EMPTY_UPDATE');
    expect(flightModel.findOne).not.toHaveBeenCalled();
  });

  it('is 403 NO_AIRLINE_ASSIGNED for a moderator without an airline', async () => {
    const { service, flightModel } = setup({ assignedTo: null });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { departureLocalInput: '2026-12-20T09:15' },
        moderator,
      ),
    );
    expect(codeOf(error)).toBe('NO_AIRLINE_ASSIGNED');
    expect(flightModel.findOne).not.toHaveBeenCalled();
  });

  it('is 403 AIRLINE_DEACTIVATED and writes nothing (ACC-15)', async () => {
    const { service, flightModel } = setup({
      current: CURRENT,
      airlineStatus: AirlineStatus.DEACTIVATED,
    });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { departureLocalInput: '2026-12-20T09:15' },
        moderator,
      ),
    );
    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('AIRLINE_DEACTIVATED');
    expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('is 404 FLIGHT_NOT_FOUND for a malformed id and for a flight of another airline', async () => {
    const { service, flightModel } = setup({ current: null });
    const malformed = await failure(
      service.update(
        'not-an-id',
        { departureLocalInput: '2026-12-20T09:15' },
        moderator,
      ),
    );
    expect(codeOf(malformed)).toBe('FLIGHT_NOT_FOUND');
    expect(flightModel.findOne).not.toHaveBeenCalled();
    const missing = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { departureLocalInput: '2026-12-20T09:15' },
        moderator,
      ),
    );
    expect(missing.getStatus()).toBe(404);
  });

  it.each([FlightStatus.CANCELLED, FlightStatus.DEPARTED])(
    'is 409 FLIGHT_NOT_SCHEDULED for a %s flight',
    async (status) => {
      const { service, flightModel } = setup({
        current: { ...CURRENT_PLAIN, status } as unknown as Flight,
      });
      const error = await failure(
        service.update(
          FLIGHT_ID.toString(),
          { departureLocalInput: '2026-12-20T09:15' },
          moderator,
        ),
      );
      expect(error.getStatus()).toBe(409);
      expect(codeOf(error)).toBe('FLIGHT_NOT_SCHEDULED');
      expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('is 409 FLIGHT_ALREADY_DEPARTED for a SCHEDULED flight whose time has passed', async () => {
    const { service } = setup({
      current: {
        ...CURRENT_PLAIN,
        departureAtUtc: new Date('2026-11-12T09:00:00.000Z'),
      } as unknown as Flight,
    });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { arrivalLocalInput: '2026-12-20T16:00' },
        moderator,
      ),
    );
    expect(codeOf(error)).toBe('FLIGHT_ALREADY_DEPARTED');
  });

  it('is 409 AIRPORTS_LOCKED when a seat is booked or held and the update matched nothing', async () => {
    const { service, notifications } = setup({
      current: {
        ...CURRENT_PLAIN,
        cabinInventory: [cabinWithSeats(0, 2)],
      } as unknown as Flight,
      updated: null,
    });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { arrivalAirportId: 'LHR', arrivalLocalInput: '2026-12-20T12:00' },
        moderator,
      ),
    );
    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('AIRPORTS_LOCKED');
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('is 409 FLIGHT_CHANGED when nothing explains the miss (a parallel edit)', async () => {
    const { service } = setup({ current: CURRENT, updated: null });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        { departureLocalInput: '2026-12-20T09:15' },
        moderator,
      ),
    );
    expect(codeOf(error)).toBe('FLIGHT_CHANGED');
  });

  it('is 409 FLIGHT_ALREADY_EXISTS when the new date clashes with the same flight number', async () => {
    const { service, notifications } = setup({
      current: CURRENT,
      updateError: Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      }),
    });
    const error = await failure(
      service.update(
        FLIGHT_ID.toString(),
        {
          departureLocalInput: '2026-12-22T08:30',
          arrivalLocalInput: '2026-12-22T14:30',
        },
        moderator,
      ),
    );
    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('FLIGHT_ALREADY_EXISTS');
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('never writes the seat counters, the status, the airline or the cabins', async () => {
    const { service, flightModel } = setup({
      current: CURRENT,
      updated: CURRENT,
    });
    await service.update(
      FLIGHT_ID.toString(),
      {
        departureLocalInput: '2026-12-20T09:15',
        arrivalLocalInput: '2026-12-20T15:00',
      },
      moderator,
    );
    const written = Object.keys(lastUpdate(flightModel)[1].$set).join(' ');
    expect(written).not.toMatch(
      /bookedSeats|heldSeats|totalSeats|status|airlineId|cabinInventory|flightNumber/,
    );
  });
});
