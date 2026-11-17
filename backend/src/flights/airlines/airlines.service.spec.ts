import { BadRequestException, HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AirlineActor } from './airline-actor';
import { AirlinesService } from './airlines.service';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';

const AIRLINE_ID = new Types.ObjectId();
const OTHER_AIRLINE_ID = new Types.ObjectId();
const ADMIN_ID = new Types.ObjectId().toString();
const MODERATOR_ID = new Types.ObjectId().toString();
const NOW = new Date('2026-11-09T10:00:00.000Z');

const admin: AirlineActor = { userId: ADMIN_ID, role: 'ADMIN' };
const moderator: AirlineActor = {
  userId: MODERATOR_ID,
  role: 'AIRLINE_MODERATOR',
};
const traveller: AirlineActor = {
  userId: new Types.ObjectId().toString(),
  role: 'USER',
};

function airline(overrides: Partial<Airline> = {}): Airline {
  return {
    _id: AIRLINE_ID,
    name: 'EgyptAir',
    iataCode: 'MS',
    icaoCode: 'MSR',
    logo: null,
    status: AirlineStatus.ACTIVE,
    deactivatedAt: null,
    createdBy: new Types.ObjectId(ADMIN_ID),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// A query stand-in: lean() and exec() resolve to the given result.
function query<R>(result: R) {
  const chain = {
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

// Fake models; the casts to Model are done only here. `assigned` is the airline id the
// moderator is assigned to (or null when there is no assignment document).
function setup(options: {
  stored?: Airline | null;
  assignedTo?: Types.ObjectId | null;
}) {
  const stored = options.stored === undefined ? airline() : options.stored;
  const assignedTo = options.assignedTo ?? null;

  const airlineModel = {
    create: jest.fn((doc: Partial<Airline>) =>
      Promise.resolve({
        toObject: () => airline({ ...doc, _id: AIRLINE_ID }),
      }),
    ),
    findById: jest.fn(() => query(stored)),
    exists: jest.fn(() => query(stored ? { _id: stored._id } : null)),
    findByIdAndUpdate: jest.fn(
      (_id: Types.ObjectId, update: { $set: Partial<Airline> }) =>
        query(stored ? Object.assign({}, stored, update.$set) : null),
    ),
  };
  const assignmentModel = {
    create: jest.fn(() => Promise.resolve({})),
    exists: jest.fn((filter: { airlineId: Types.ObjectId }) =>
      query(
        assignedTo && assignedTo.equals(filter.airlineId)
          ? { _id: new Types.ObjectId() }
          : null,
      ),
    ),
  };
  const service = new AirlinesService(
    airlineModel as unknown as Model<Airline>,
    assignmentModel as unknown as Model<AirlineModeratorAssignment>,
  );
  return { service, airlineModel, assignmentModel };
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

describe('AirlinesService.create (FLT-01)', () => {
  it('creates an ACTIVE airline for an admin and returns the public fields only', async () => {
    const { service, airlineModel } = setup({});
    const result = await service.create(
      { name: 'EgyptAir', iataCode: 'MS', icaoCode: 'MSR' },
      admin,
    );

    expect(airlineModel.create).toHaveBeenCalledWith({
      name: 'EgyptAir',
      iataCode: 'MS',
      icaoCode: 'MSR',
      status: AirlineStatus.ACTIVE,
      createdBy: new Types.ObjectId(ADMIN_ID),
    });
    expect(result).toEqual({
      id: AIRLINE_ID.toString(),
      name: 'EgyptAir',
      iataCode: 'MS',
      icaoCode: 'MSR',
      logo: null,
      status: 'ACTIVE',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(result).not.toHaveProperty('createdBy');
  });

  it('leaves icaoCode out when it is not sent', async () => {
    const { service, airlineModel } = setup({});
    await service.create({ name: 'EgyptAir', iataCode: 'MS' }, admin);
    expect(airlineModel.create.mock.calls[0][0]).not.toHaveProperty('icaoCode');
  });

  it.each([moderator, traveller])(
    'rejects the role $role with 403',
    async (actor) => {
      const { service, airlineModel } = setup({});
      const error = await failure(
        service.create({ name: 'EgyptAir', iataCode: 'MS' }, actor),
      );
      expect(error.getStatus()).toBe(403);
      expect(airlineModel.create).not.toHaveBeenCalled();
    },
  );
});

describe('AirlinesService.findOne (FLT-01)', () => {
  it('shows an ACTIVE airline to a guest', async () => {
    const { service } = setup({});
    const result = await service.findOne(AIRLINE_ID.toString());
    expect(result.iataCode).toBe('MS');
  });

  it('returns 404 AIRLINE_NOT_FOUND for an unknown id', async () => {
    const { service } = setup({ stored: null });
    const error = await failure(service.findOne(AIRLINE_ID.toString()));
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({ code: 'AIRLINE_NOT_FOUND' });
  });

  describe('a DEACTIVATED airline', () => {
    const stored = airline({ status: AirlineStatus.DEACTIVATED });

    it('is hidden from a guest and from a traveller (404)', async () => {
      const { service } = setup({ stored });
      for (const actor of [undefined, traveller]) {
        const error = await failure(
          service.findOne(AIRLINE_ID.toString(), actor),
        );
        expect(error.getStatus()).toBe(404);
      }
    });

    it('is shown to an admin', async () => {
      const { service } = setup({ stored });
      const result = await service.findOne(AIRLINE_ID.toString(), admin);
      expect(result.status).toBe('DEACTIVATED');
    });

    it('is shown to its assigned moderator', async () => {
      const { service } = setup({ stored, assignedTo: AIRLINE_ID });
      const result = await service.findOne(AIRLINE_ID.toString(), moderator);
      expect(result.status).toBe('DEACTIVATED');
    });

    it('is hidden from a moderator assigned to another airline (404)', async () => {
      const { service } = setup({ stored, assignedTo: OTHER_AIRLINE_ID });
      const error = await failure(
        service.findOne(AIRLINE_ID.toString(), moderator),
      );
      expect(error.getStatus()).toBe(404);
    });
  });
});

describe('AirlinesService.update (FLT-01)', () => {
  it('lets an admin edit any airline and sends only the changed fields', async () => {
    const { service, airlineModel } = setup({});
    const result = await service.update(
      AIRLINE_ID.toString(),
      { name: 'EgyptAir Express' },
      admin,
    );
    expect(airlineModel.findByIdAndUpdate).toHaveBeenCalledWith(
      AIRLINE_ID,
      { $set: { name: 'EgyptAir Express' } },
      { returnDocument: 'after', runValidators: true },
    );
    expect(result.name).toBe('EgyptAir Express');
  });

  it('lets the assigned moderator edit their own airline', async () => {
    const { service } = setup({ assignedTo: AIRLINE_ID });
    const result = await service.update(
      AIRLINE_ID.toString(),
      { iataCode: 'MS', icaoCode: 'MSR' },
      moderator,
    );
    expect(result.iataCode).toBe('MS');
  });

  it('rejects a moderator of another airline with 403 and writes nothing', async () => {
    const { service, airlineModel } = setup({ assignedTo: OTHER_AIRLINE_ID });
    const error = await failure(
      service.update(AIRLINE_ID.toString(), { name: 'Hijack' }, moderator),
    );
    expect(error.getStatus()).toBe(403);
    expect(airlineModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a moderator with no assignment with 403', async () => {
    const { service } = setup({ assignedTo: null });
    const error = await failure(
      service.update(AIRLINE_ID.toString(), { name: 'X' }, moderator),
    );
    expect(error.getStatus()).toBe(403);
  });

  it('rejects a traveller with 403 before touching the database', async () => {
    const { service, airlineModel } = setup({});
    const error = await failure(
      service.update(AIRLINE_ID.toString(), { name: 'X' }, traveller),
    );
    expect(error.getStatus()).toBe(403);
    expect(airlineModel.exists).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown airline', async () => {
    const { service } = setup({ stored: null });
    const error = await failure(
      service.update(AIRLINE_ID.toString(), { name: 'X' }, admin),
    );
    expect(error.getStatus()).toBe(404);
  });

  it('returns 400 EMPTY_UPDATE with a field error when nothing is sent', async () => {
    const { service, airlineModel } = setup({});
    const error = await failure(
      service.update(AIRLINE_ID.toString(), {}, admin),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({
      code: 'EMPTY_UPDATE',
      errors: [{ field: 'body' }],
    });
    expect(airlineModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('AirlinesService.assignModerator (ACC-13 hook)', () => {
  it('stores one assignment for an existing airline', async () => {
    const { service, assignmentModel } = setup({});
    await service.assignModerator(MODERATOR_ID, AIRLINE_ID.toString());
    expect(assignmentModel.create).toHaveBeenCalledWith({
      moderatorId: new Types.ObjectId(MODERATOR_ID),
      airlineId: AIRLINE_ID,
    });
  });

  it('returns 404 and stores nothing for an unknown airline', async () => {
    const { service, assignmentModel } = setup({ stored: null });
    const error = await failure(
      service.assignModerator(MODERATOR_ID, AIRLINE_ID.toString()),
    );
    expect(error.getStatus()).toBe(404);
    expect(assignmentModel.create).not.toHaveBeenCalled();
  });
});
