import { BadRequestException, HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { AirportDto } from '../../common/reference-data/dto/airport.dto';
import type { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { Flight, FlightStatus } from '../schemas/flight.schema';
import { FlightsService } from './flights.service';

const AIRLINE_ID = new Types.ObjectId();
const FLIGHT_ID = new Types.ObjectId();
const MODERATOR_ID = new Types.ObjectId().toString();
// The server clock in every test.
const NOW = new Date('2026-11-12T10:00:00.000Z');

const moderator: AuthenticatedUser = {
  userId: MODERATOR_ID,
  role: Role.AIRLINE_MODERATOR,
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

// A query stand-in: lean() and exec() resolve to the given result.
function query<R>(result: R) {
  const chain = {
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

// Fake models and reference data; the casts are done only here.
function setup(
  options: {
    assignedTo?: Types.ObjectId | null;
    createError?: unknown;
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
  const flightModel = {
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
  const service = new FlightsService(
    flightModel as unknown as Model<Flight>,
    assignmentModel as unknown as Model<AirlineModeratorAssignment>,
    referenceData as unknown as ReferenceDataService,
  );
  return { service, flightModel, assignmentModel, referenceData };
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
