import { HttpException } from '@nestjs/common';
import type { ClientSession, Model } from 'mongoose';
import { Types } from 'mongoose';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import { SeatChange, SeatInventoryService } from './seat-inventory.service';

const FLIGHT_ID = new Types.ObjectId();
const IN_ONE_DAY = new Date(Date.now() + 24 * 60 * 60 * 1000);
const ONE_DAY_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);
const SESSION = {} as unknown as ClientSession;

function change(overrides: Partial<SeatChange> = {}): SeatChange {
  return {
    flightId: FLIGHT_ID,
    category: CabinCategory.ECONOMY,
    seats: 2,
    ...overrides,
  };
}

// The parts of a stored flight that the failure read looks at.
function storedFlight(overrides: Partial<Flight> = {}): Partial<Flight> {
  return {
    _id: FLIGHT_ID,
    status: FlightStatus.SCHEDULED,
    departureAtUtc: IN_ONE_DAY,
    cabinInventory: [
      {
        category: CabinCategory.ECONOMY,
        totalSeats: 10,
        bookedSeats: 8,
        heldSeats: 1,
      },
    ] as Flight['cabinInventory'],
    ...overrides,
  };
}

// Fake flight model that records every call; the cast to Model is done only here.
function setup(options: {
  modifiedCount: number;
  stored?: Partial<Flight> | null;
}) {
  const calls: {
    update?: { filter: unknown; update: unknown; options: unknown };
    readSession?: unknown;
  } = {};
  const flightModel = {
    updateOne: jest.fn((filter: unknown, update: unknown, opts: unknown) => {
      calls.update = { filter, update, options: opts };
      return {
        exec: () => Promise.resolve({ modifiedCount: options.modifiedCount }),
      };
    }),
    findById: jest.fn(() => {
      const chain = {
        session: (session: unknown) => {
          calls.readSession = session;
          return chain;
        },
        lean: () => chain,
        exec: () =>
          Promise.resolve(
            options.stored === undefined ? storedFlight() : options.stored,
          ),
      };
      return chain;
    }),
  };
  const service = new SeatInventoryService(
    flightModel as unknown as Model<Flight>,
  );
  return { service, flightModel, calls };
}

async function httpError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an HttpException');
}

describe('SeatInventoryService.hold', () => {
  it('sends one conditional update that holds the seats in the chosen cabin', async () => {
    const { service, calls } = setup({ modifiedCount: 1 });
    await service.hold(change(), SESSION);

    const filter = calls.update?.filter as Record<string, unknown>;
    expect(filter._id).toBe(FLIGHT_ID);
    expect(filter.status).toBe(FlightStatus.SCHEDULED);
    expect(filter.departureAtUtc).toEqual({ $gt: expect.any(Date) });
    expect(filter.$expr).toEqual({
      $anyElementTrue: [
        {
          $map: {
            input: '$cabinInventory',
            as: 'cabin',
            in: {
              $and: [
                { $eq: ['$$cabin.category', 'ECONOMY'] },
                {
                  $lte: [
                    { $add: ['$$cabin.bookedSeats', '$$cabin.heldSeats', 2] },
                    '$$cabin.totalSeats',
                  ],
                },
              ],
            },
          },
        },
      ],
    });
    expect(calls.update?.update).toEqual({
      $inc: { 'cabinInventory.$[cabin].heldSeats': 2 },
    });
    expect(calls.update?.options).toEqual({
      arrayFilters: [{ 'cabin.category': 'ECONOMY' }],
      session: SESSION,
    });
  });

  it('does not read the flight again when the hold succeeds', async () => {
    const { service, flightModel } = setup({ modifiedCount: 1 });
    await service.hold(change());
    expect(flightModel.findById).not.toHaveBeenCalled();
  });

  it.each([
    ['the flight does not exist', null, 404, 'FLIGHT_NOT_FOUND'],
    [
      'the flight is cancelled',
      storedFlight({ status: FlightStatus.CANCELLED }),
      409,
      'FLIGHT_NOT_BOOKABLE',
    ],
    [
      'the flight has departed',
      storedFlight({ departureAtUtc: ONE_DAY_AGO }),
      409,
      'FLIGHT_NOT_BOOKABLE',
    ],
  ])('reports %s', async (_case, stored, status, code) => {
    const { service } = setup({ modifiedCount: 0, stored });
    const error = await httpError(service.hold(change()));
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
  });

  it('reports a cabin the flight does not have with 400 CABIN_NOT_OFFERED', async () => {
    const { service } = setup({ modifiedCount: 0 });
    const error = await httpError(
      service.hold(change({ category: CabinCategory.FIRST })),
    );
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      code: 'CABIN_NOT_OFFERED',
      message: 'This flight has no FIRST cabin',
    });
  });

  it.each([
    [2, 1, 'Only 1 seat left in ECONOMY'],
    [3, 0, 'No seats left in ECONOMY'],
    [1, 9, 'The ECONOMY seats changed while booking, please try again'],
  ])(
    'reports %i seats requested with %i left as 409 SEAT_UNAVAILABLE',
    async (seats, left, message) => {
      const stored = storedFlight({
        cabinInventory: [
          {
            category: CabinCategory.ECONOMY,
            totalSeats: 10,
            bookedSeats: 10 - left,
            heldSeats: 0,
          },
        ] as Flight['cabinInventory'],
      });
      const { service } = setup({ modifiedCount: 0, stored });
      const error = await httpError(service.hold(change({ seats })));
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual({
        code: 'SEAT_UNAVAILABLE',
        message,
      });
    },
  );

  it('reads the flight in the same session when the hold fails', async () => {
    const { service, calls } = setup({ modifiedCount: 0 });
    await httpError(service.hold(change(), SESSION));
    expect(calls.readSession).toBe(SESSION);
  });

  it.each([0, -1, 1.5])(
    'throws for %p seats without touching the database',
    async (seats) => {
      const { service, flightModel } = setup({ modifiedCount: 1 });
      await expect(service.hold(change({ seats }))).rejects.toThrow(
        'seats must be a whole number >= 1',
      );
      expect(flightModel.updateOne).not.toHaveBeenCalled();
    },
  );
});

describe('SeatInventoryService releases and conversion', () => {
  type Method = 'releaseHeld' | 'convertHeldToBooked' | 'releaseBooked';

  it.each<[Method, Record<string, unknown>, Record<string, number>]>([
    [
      'releaseHeld',
      { category: 'ECONOMY', heldSeats: { $gte: 2 } },
      { 'cabinInventory.$.heldSeats': -2 },
    ],
    [
      'convertHeldToBooked',
      { category: 'ECONOMY', heldSeats: { $gte: 2 } },
      { 'cabinInventory.$.heldSeats': -2, 'cabinInventory.$.bookedSeats': 2 },
    ],
    [
      'releaseBooked',
      { category: 'ECONOMY', bookedSeats: { $gte: 2 } },
      { 'cabinInventory.$.bookedSeats': -2 },
    ],
  ])(
    '%s sends one update that never lets a counter go below 0',
    async (method, elemMatch, inc) => {
      const { service, calls } = setup({ modifiedCount: 1 });
      await service[method](change(), SESSION);

      expect(calls.update).toEqual({
        filter: { _id: FLIGHT_ID, cabinInventory: { $elemMatch: elemMatch } },
        update: { $inc: inc },
        options: { session: SESSION },
      });
    },
  );

  it.each<Method>(['releaseHeld', 'convertHeldToBooked', 'releaseBooked'])(
    '%s throws a non-HTTP error (500) when the counter is too low',
    async (method) => {
      const { service } = setup({ modifiedCount: 0 });
      const result = service[method](change());
      await expect(result).rejects.toThrow('Seat counters out of sync');
      await expect(result).rejects.not.toBeInstanceOf(HttpException);
    },
  );

  it.each<Method>(['releaseHeld', 'convertHeldToBooked', 'releaseBooked'])(
    '%s throws for an invalid seat count without touching the database',
    async (method) => {
      const { service, flightModel } = setup({ modifiedCount: 1 });
      await expect(service[method](change({ seats: 0 }))).rejects.toThrow(
        'seats must be a whole number >= 1',
      );
      expect(flightModel.updateOne).not.toHaveBeenCalled();
    },
  );
});
