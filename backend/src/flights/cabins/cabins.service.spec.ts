import { HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import { CabinsService } from './cabins.service';

const AIRLINE_ID = new Types.ObjectId();
const FLIGHT_ID = new Types.ObjectId();
const MODERATOR_ID = new Types.ObjectId().toString();
const NOW = new Date('2026-11-17T10:00:00.000Z');
const DEPARTURE = new Date('2026-12-20T06:30:00.000Z');

const moderator: AuthenticatedUser = {
  userId: MODERATOR_ID,
  role: Role.AIRLINE_MODERATOR,
  sessionId: new Types.ObjectId().toString(),
};

const NEW_CABIN = {
  category: CabinCategory.ECONOMY,
  totalSeats: 150,
  price: 199.99,
  freeBaggageCount: 1,
  maxBagWeightKg: 23,
};

function flightDoc(cabinInventory: object[] = []): Flight {
  return {
    _id: FLIGHT_ID,
    airlineId: AIRLINE_ID,
    flightNumber: 'MS777',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureLocalInput: '2026-12-20T08:30',
    arrivalLocalInput: '2026-12-20T14:30',
    departureAtUtc: DEPARTURE,
    arrivalAtUtc: new Date('2026-12-20T10:30:00.000Z'),
    departureDateKey: '2026-12-20',
    status: FlightStatus.SCHEDULED,
    cabinInventory,
    createdAt: NOW,
    updatedAt: NOW,
  } as Flight;
}

const storedCabin = (price = '199.99') => ({
  category: CabinCategory.ECONOMY,
  totalSeats: 150,
  bookedSeats: 0,
  heldSeats: 0,
  price: Types.Decimal128.fromString(price),
  freeBaggageCount: 1,
  maxBagWeightKg: 23,
});

// A query stand-in: select(), lean() and exec() resolve to the given result.
function query<R>(result: R) {
  const chain = {
    select: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

function setup(
  options: {
    assignedTo?: Types.ObjectId | null;
    updated?: Flight | null;
    current?: object | null;
  } = {},
) {
  const assignedTo =
    options.assignedTo === undefined ? AIRLINE_ID : options.assignedTo;
  const assignmentModel = {
    findOne: jest.fn(() =>
      query(assignedTo ? { airlineId: assignedTo } : null),
    ),
  };
  const flightModel = {
    findOneAndUpdate: jest.fn(() =>
      query(options.updated === undefined ? null : options.updated),
    ),
    findOne: jest.fn(() =>
      query(options.current === undefined ? null : options.current),
    ),
  };
  const service = new CabinsService(
    flightModel as unknown as Model<Flight>,
    assignmentModel as unknown as Model<AirlineModeratorAssignment>,
  );
  return { service, flightModel, assignmentModel };
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

const codeOf = (error: HttpException): unknown =>
  (error.getResponse() as { code?: unknown }).code;

type UpdateCall = [
  Record<string, unknown>,
  Record<string, Record<string, unknown>>,
  { new: boolean },
];

describe('CabinsService.add (FLT-04)', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pushes the cabin with 0 booked / 0 held and a Decimal128 price, in one conditional update', async () => {
    const { service, flightModel } = setup({
      updated: flightDoc([storedCabin()]),
    });
    const result = await service.add(
      FLIGHT_ID.toString(),
      NEW_CABIN,
      moderator,
    );

    expect(result.cabinInventory).toEqual([
      {
        category: 'ECONOMY',
        totalSeats: 150,
        bookedSeats: 0,
        heldSeats: 0,
        price: '199.99',
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
    ]);
    const [filter, update, options] = (
      flightModel.findOneAndUpdate.mock.calls as unknown as UpdateCall[]
    )[0];
    // Every rule is in the filter: own airline, SCHEDULED, not departed, category free.
    expect(filter).toEqual({
      _id: FLIGHT_ID.toString(),
      airlineId: AIRLINE_ID,
      status: FlightStatus.SCHEDULED,
      departureAtUtc: { $gt: NOW },
      'cabinInventory.category': { $ne: 'ECONOMY' },
    });
    const pushed = update.$push.cabinInventory as Record<string, unknown>;
    expect(pushed).toMatchObject({
      category: 'ECONOMY',
      totalSeats: 150,
      bookedSeats: 0,
      heldSeats: 0,
      freeBaggageCount: 1,
      maxBagWeightKg: 23,
    });
    expect(pushed.price).toBeInstanceOf(Types.Decimal128);
    expect(String(pushed.price)).toBe('199.99');
    expect(options).toEqual({ new: true });
  });

  it('stores a whole price with two decimals, never as a float', async () => {
    const { service, flightModel } = setup({ updated: flightDoc([]) });
    await service.add(
      FLIGHT_ID.toString(),
      { ...NEW_CABIN, price: 500 },
      moderator,
    );
    const [, update] = (
      flightModel.findOneAndUpdate.mock.calls as unknown as UpdateCall[]
    )[0];
    expect(
      String((update.$push.cabinInventory as { price: unknown }).price),
    ).toBe('500.00');
  });

  it('is 403 NO_AIRLINE_ASSIGNED for a moderator without an airline, and writes nothing', async () => {
    const { service, flightModel } = setup({ assignedTo: null });
    const error = await failure(
      service.add(FLIGHT_ID.toString(), NEW_CABIN, moderator),
    );
    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('NO_AIRLINE_ASSIGNED');
    expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('is 404 FLIGHT_NOT_FOUND for a malformed id, without any query', async () => {
    const { service, flightModel } = setup();
    const error = await failure(service.add('not-an-id', NEW_CABIN, moderator));
    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('FLIGHT_NOT_FOUND');
    expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(flightModel.findOne).not.toHaveBeenCalled();
  });

  it('is 404 FLIGHT_NOT_FOUND when the flight is missing or belongs to another airline', async () => {
    const { service, flightModel } = setup({ current: null });
    const error = await failure(
      service.add(FLIGHT_ID.toString(), NEW_CABIN, moderator),
    );
    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('FLIGHT_NOT_FOUND');
    // The explanation read is also limited to the moderator's airline.
    expect(flightModel.findOne).toHaveBeenCalledWith({
      _id: FLIGHT_ID.toString(),
      airlineId: AIRLINE_ID,
    });
  });

  it.each([FlightStatus.CANCELLED, FlightStatus.DEPARTED])(
    'is 409 FLIGHT_NOT_SCHEDULED for a %s flight',
    async (status) => {
      const { service } = setup({
        current: { status, departureAtUtc: DEPARTURE, cabinInventory: [] },
      });
      const error = await failure(
        service.add(FLIGHT_ID.toString(), NEW_CABIN, moderator),
      );
      expect(error.getStatus()).toBe(409);
      expect(codeOf(error)).toBe('FLIGHT_NOT_SCHEDULED');
    },
  );

  it('is 409 FLIGHT_ALREADY_DEPARTED for a SCHEDULED flight whose time has passed', async () => {
    const { service } = setup({
      current: {
        status: FlightStatus.SCHEDULED,
        departureAtUtc: new Date('2026-11-17T09:00:00.000Z'),
        cabinInventory: [],
      },
    });
    const error = await failure(
      service.add(FLIGHT_ID.toString(), NEW_CABIN, moderator),
    );
    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('FLIGHT_ALREADY_DEPARTED');
  });

  it('is 409 CABIN_ALREADY_EXISTS when the category is already on the flight', async () => {
    const { service } = setup({
      current: {
        status: FlightStatus.SCHEDULED,
        departureAtUtc: DEPARTURE,
        cabinInventory: [{ category: CabinCategory.ECONOMY }],
      },
    });
    const error = await failure(
      service.add(FLIGHT_ID.toString(), NEW_CABIN, moderator),
    );
    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('CABIN_ALREADY_EXISTS');
    expect(
      (error.getResponse() as { errors: { field: string }[] }).errors[0].field,
    ).toBe('category');
  });

  it('is 409 FLIGHT_CHANGED when nothing explains the miss (a parallel change)', async () => {
    const { service } = setup({
      current: {
        status: FlightStatus.SCHEDULED,
        departureAtUtc: DEPARTURE,
        cabinInventory: [],
      },
    });
    const error = await failure(
      service.add(FLIGHT_ID.toString(), NEW_CABIN, moderator),
    );
    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('FLIGHT_CHANGED');
  });
});

describe('CabinsService.update (FLT-04, FLT-05)', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sets only the fields sent, on the matched cabin, in one conditional update', async () => {
    const { service, flightModel } = setup({
      updated: flightDoc([storedCabin('179.50')]),
    });
    const result = await service.update(
      FLIGHT_ID.toString(),
      'economy',
      { price: 179.5 },
      moderator,
    );
    expect(result.cabinInventory[0].price).toBe('179.50');
    const [filter, update] = (
      flightModel.findOneAndUpdate.mock.calls as unknown as UpdateCall[]
    )[0];
    expect(filter).toEqual({
      _id: FLIGHT_ID.toString(),
      airlineId: AIRLINE_ID,
      status: FlightStatus.SCHEDULED,
      departureAtUtc: { $gt: NOW },
      'cabinInventory.category': 'ECONOMY',
    });
    expect(Object.keys(update.$set)).toEqual(['cabinInventory.$.price']);
    expect(String(update.$set['cabinInventory.$.price'])).toBe('179.50');
  });

  it('can change the baggage allowance without touching the price', async () => {
    const { service, flightModel } = setup({
      updated: flightDoc([storedCabin()]),
    });
    await service.update(
      FLIGHT_ID.toString(),
      'BUSINESS',
      { freeBaggageCount: 2, maxBagWeightKg: 32 },
      moderator,
    );
    const [, update] = (
      flightModel.findOneAndUpdate.mock.calls as unknown as UpdateCall[]
    )[0];
    expect(update.$set).toEqual({
      'cabinInventory.$.freeBaggageCount': 2,
      'cabinInventory.$.maxBagWeightKg': 32,
    });
  });

  it('never writes the seat counters or the seat total', async () => {
    const { service, flightModel } = setup({ updated: flightDoc([]) });
    await service.update(
      FLIGHT_ID.toString(),
      'ECONOMY',
      { price: 10, freeBaggageCount: 1, maxBagWeightKg: 20 },
      moderator,
    );
    const [, update] = (
      flightModel.findOneAndUpdate.mock.calls as unknown as UpdateCall[]
    )[0];
    const written = Object.keys(update.$set).join(' ');
    expect(written).not.toMatch(/bookedSeats|heldSeats|totalSeats/);
  });

  it('is 400 EMPTY_UPDATE when nothing is sent, without updating', async () => {
    const { service, flightModel } = setup();
    const error = await failure(
      service.update(FLIGHT_ID.toString(), 'ECONOMY', {}, moderator),
    );
    expect(error.getStatus()).toBe(400);
    expect(codeOf(error)).toBe('EMPTY_UPDATE');
    expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('is 404 CABIN_NOT_FOUND for a category outside the fixed set, without a query', async () => {
    const { service, flightModel } = setup();
    const error = await failure(
      service.update(FLIGHT_ID.toString(), 'LUXURY', { price: 1 }, moderator),
    );
    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('CABIN_NOT_FOUND');
    expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('is 403 NO_AIRLINE_ASSIGNED for a moderator without an airline', async () => {
    const { service, flightModel } = setup({ assignedTo: null });
    const error = await failure(
      service.update(FLIGHT_ID.toString(), 'ECONOMY', { price: 1 }, moderator),
    );
    expect(error.getStatus()).toBe(403);
    expect(flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("is 404 FLIGHT_NOT_FOUND for a malformed id and for another airline's flight", async () => {
    const malformed = await failure(
      setup().service.update('nope', 'ECONOMY', { price: 1 }, moderator),
    );
    expect(codeOf(malformed)).toBe('FLIGHT_NOT_FOUND');

    const foreign = await failure(
      setup({ current: null }).service.update(
        FLIGHT_ID.toString(),
        'ECONOMY',
        { price: 1 },
        moderator,
      ),
    );
    expect(foreign.getStatus()).toBe(404);
    expect(codeOf(foreign)).toBe('FLIGHT_NOT_FOUND');
  });

  it('is 404 CABIN_NOT_FOUND when the flight has no such cabin', async () => {
    const { service } = setup({
      current: {
        status: FlightStatus.SCHEDULED,
        departureAtUtc: DEPARTURE,
        cabinInventory: [{ category: CabinCategory.BUSINESS }],
      },
    });
    const error = await failure(
      service.update(FLIGHT_ID.toString(), 'ECONOMY', { price: 1 }, moderator),
    );
    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('CABIN_NOT_FOUND');
  });

  it('is 409 FLIGHT_NOT_SCHEDULED for a CANCELLED flight', async () => {
    const { service } = setup({
      current: {
        status: FlightStatus.CANCELLED,
        departureAtUtc: DEPARTURE,
        cabinInventory: [{ category: CabinCategory.ECONOMY }],
      },
    });
    const error = await failure(
      service.update(FLIGHT_ID.toString(), 'ECONOMY', { price: 1 }, moderator),
    );
    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('FLIGHT_NOT_SCHEDULED');
  });

  it('is 409 FLIGHT_ALREADY_DEPARTED for a SCHEDULED flight whose time has passed', async () => {
    const { service } = setup({
      current: {
        status: FlightStatus.SCHEDULED,
        departureAtUtc: new Date('2026-11-17T09:59:00.000Z'),
        cabinInventory: [{ category: CabinCategory.ECONOMY }],
      },
    });
    const error = await failure(
      service.update(FLIGHT_ID.toString(), 'ECONOMY', { price: 1 }, moderator),
    );
    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('FLIGHT_ALREADY_DEPARTED');
  });
});
