import { HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { AirlinePolicy } from '../schemas/airline-policy.schema';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { AirlinePoliciesService } from './airline-policies.service';

const AIRLINE_ID = new Types.ObjectId();
const MODERATOR_ID = new Types.ObjectId();
const NOW = new Date('2026-11-17T10:00:00.000Z');

const moderator: AuthenticatedUser = {
  userId: MODERATOR_ID.toString(),
  role: Role.AIRLINE_MODERATOR,
  sessionId: new Types.ObjectId().toString(),
};

const BAGGAGE = { extraBagPrice: 25, maxExtraBagsPerPassenger: 2 };
const TIERS = {
  cancellationTiers: [
    { daysBeforeDeparture: 0, refundPercentage: 0 },
    { daysBeforeDeparture: 14, refundPercentage: 100 },
    { daysBeforeDeparture: 7, refundPercentage: 50 },
  ],
};

function stored(overrides: Partial<AirlinePolicy> = {}): AirlinePolicy {
  return {
    _id: new Types.ObjectId(),
    airlineId: AIRLINE_ID,
    extraBagPrice: Types.Decimal128.fromString('25.00'),
    maxExtraBagsPerPassenger: 2,
    cancellationTiers: [],
    version: 1,
    updatedBy: MODERATOR_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

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
    airlineStatus?: AirlineStatus | null;
    assigned?: boolean;
    saved?: AirlinePolicy;
    upsertErrors?: unknown[];
  } = {},
) {
  const airlineStatus =
    options.airlineStatus === undefined
      ? AirlineStatus.ACTIVE
      : options.airlineStatus;
  const airlineModel = {
    findById: jest.fn(() =>
      query(airlineStatus ? { status: airlineStatus } : null),
    ),
  };
  const assignmentModel = {
    exists: jest.fn(() =>
      query(options.assigned === false ? null : { _id: 1 }),
    ),
  };
  const errors = [...(options.upsertErrors ?? [])];
  const policyModel = {
    findOne: jest.fn(() => query(options.saved ?? null)),
    findOneAndUpdate: jest.fn(() => {
      const error = errors.shift();
      return error
        ? { lean: () => ({ exec: () => Promise.reject(error as Error) }) }
        : query(options.saved ?? stored());
    }),
  };
  const service = new AirlinePoliciesService(
    policyModel as unknown as Model<AirlinePolicy>,
    airlineModel as unknown as Model<Airline>,
    assignmentModel as unknown as Model<AirlineModeratorAssignment>,
  );
  return { service, policyModel, airlineModel, assignmentModel };
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

type UpsertCall = [
  { airlineId: Types.ObjectId },
  Record<string, Record<string, unknown>>,
  { upsert: boolean; returnDocument: string; runValidators: boolean },
];

describe('AirlinePoliciesService.setBaggagePolicy (FLT-08)', () => {
  it('upserts the baggage part in one conditional update and returns the policy', async () => {
    const { service, policyModel } = setup();
    const result = await service.setBaggagePolicy(
      AIRLINE_ID.toString(),
      BAGGAGE,
      moderator,
    );

    expect(result).toEqual({
      airlineId: AIRLINE_ID.toString(),
      extraBagPrice: '25.00',
      maxExtraBagsPerPassenger: 2,
      cancellationTiers: [],
      version: 1,
      updatedAt: NOW.toISOString(),
    });
    expect(policyModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = policyModel.findOneAndUpdate.mock
      .calls[0] as unknown as UpsertCall;
    expect(filter).toEqual({ airlineId: AIRLINE_ID });
    expect(update.$set.extraBagPrice).toBeInstanceOf(Types.Decimal128);
    expect(String(update.$set.extraBagPrice)).toBe('25.00');
    expect(update.$set.maxExtraBagsPerPassenger).toBe(2);
    expect(update.$set.updatedBy).toEqual(MODERATOR_ID);
    expect(update.$inc).toEqual({ version: 1 });
    expect(update.$setOnInsert).toEqual({ cancellationTiers: [] });
    expect(options).toMatchObject({ upsert: true, returnDocument: 'after' });
    expect(options.runValidators).toBe(true);
  });

  it('never touches the cancellation tiers of an existing policy', async () => {
    const { service, policyModel } = setup();
    await service.setBaggagePolicy(AIRLINE_ID.toString(), BAGGAGE, moderator);
    const [, update] = policyModel.findOneAndUpdate.mock
      .calls[0] as unknown as UpsertCall;
    expect(Object.keys(update.$set)).not.toContain('cancellationTiers');
  });

  it('accepts 0 extra bags', async () => {
    const { service, policyModel } = setup();
    await service.setBaggagePolicy(
      AIRLINE_ID.toString(),
      { extraBagPrice: 10, maxExtraBagsPerPassenger: 0 },
      moderator,
    );
    const [, update] = policyModel.findOneAndUpdate.mock
      .calls[0] as unknown as UpsertCall;
    expect(update.$set.maxExtraBagsPerPassenger).toBe(0);
  });
});

describe('AirlinePoliciesService.setCancellationPolicy (FLT-09)', () => {
  it('stores the tiers highest threshold first and keeps the baggage part', async () => {
    const { service, policyModel } = setup({
      saved: stored({
        cancellationTiers: [
          { daysBeforeDeparture: 14, refundPercentage: 100 },
          { daysBeforeDeparture: 7, refundPercentage: 50 },
          { daysBeforeDeparture: 0, refundPercentage: 0 },
        ],
        version: 2,
      }),
    });
    const result = await service.setCancellationPolicy(
      AIRLINE_ID.toString(),
      TIERS,
      moderator,
    );

    const [filter, update] = policyModel.findOneAndUpdate.mock
      .calls[0] as unknown as UpsertCall;
    expect(filter).toEqual({ airlineId: AIRLINE_ID });
    expect(update.$set.cancellationTiers).toEqual([
      { daysBeforeDeparture: 14, refundPercentage: 100 },
      { daysBeforeDeparture: 7, refundPercentage: 50 },
      { daysBeforeDeparture: 0, refundPercentage: 0 },
    ]);
    expect(Object.keys(update.$set)).not.toContain('extraBagPrice');
    expect(update.$inc).toEqual({ version: 1 });
    expect(update.$setOnInsert).toEqual({
      extraBagPrice: null,
      maxExtraBagsPerPassenger: null,
    });
    expect(result.version).toBe(2);
    expect(result.cancellationTiers).toHaveLength(3);
  });

  it('returns a null baggage part when it was never defined', async () => {
    const { service } = setup({
      saved: stored({ extraBagPrice: null, maxExtraBagsPerPassenger: null }),
    });
    const result = await service.setCancellationPolicy(
      AIRLINE_ID.toString(),
      { cancellationTiers: [] },
      moderator,
    );
    expect(result.extraBagPrice).toBeNull();
    expect(result.maxExtraBagsPerPassenger).toBeNull();
    expect(result.cancellationTiers).toEqual([]);
  });

  it('does not expose updatedBy', async () => {
    const { service } = setup();
    const result = await service.setCancellationPolicy(
      AIRLINE_ID.toString(),
      { cancellationTiers: [] },
      moderator,
    );
    expect(Object.keys(result)).not.toContain('updatedBy');
  });
});

describe.each([
  [
    'setBaggagePolicy',
    (s: AirlinePoliciesService) =>
      s.setBaggagePolicy(AIRLINE_ID.toString(), BAGGAGE, moderator),
  ],
  [
    'setCancellationPolicy',
    (s: AirlinePoliciesService) =>
      s.setCancellationPolicy(AIRLINE_ID.toString(), TIERS, moderator),
  ],
])('%s access rules (ACC-11, ACC-15)', (_name, call) => {
  it('is 404 AIRLINE_NOT_FOUND for an unknown airline and writes nothing', async () => {
    const { service, policyModel } = setup({ airlineStatus: null });
    const error = await failure(call(service));
    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('AIRLINE_NOT_FOUND');
    expect(policyModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('is 403 NOT_ASSIGNED_TO_AIRLINE for a moderator who is not assigned to this airline, and writes nothing', async () => {
    const { service, policyModel, assignmentModel } = setup({
      assigned: false,
    });
    const error = await failure(call(service));
    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('NOT_ASSIGNED_TO_AIRLINE');
    expect(assignmentModel.exists).toHaveBeenCalledWith({
      moderatorId: MODERATOR_ID,
      airlineId: AIRLINE_ID,
    });
    expect(policyModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('is 403 AIRLINE_DEACTIVATED for a DEACTIVATED airline, and writes nothing', async () => {
    const { service, policyModel } = setup({
      airlineStatus: AirlineStatus.DEACTIVATED,
    });
    const error = await failure(call(service));
    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('AIRLINE_DEACTIVATED');
    expect(policyModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not reveal a deactivated airline to a moderator of another airline', async () => {
    const { service } = setup({
      airlineStatus: AirlineStatus.DEACTIVATED,
      assigned: false,
    });
    const error = await failure(call(service));
    expect(codeOf(error)).toBe('NOT_ASSIGNED_TO_AIRLINE');
  });

  it('retries once when two first requests race on the unique index', async () => {
    const { service, policyModel } = setup({
      upsertErrors: [{ code: 11000 }],
    });
    await call(service);
    expect(policyModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second duplicate-key error', async () => {
    const { service, policyModel } = setup({
      upsertErrors: [{ code: 11000 }, { code: 11000 }],
    });
    await expect(call(service)).rejects.toEqual({ code: 11000 });
    expect(policyModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not hide other database errors', async () => {
    const { service, policyModel } = setup({
      upsertErrors: [new Error('connection lost')],
    });
    await expect(call(service)).rejects.toThrow('connection lost');
    expect(policyModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('AirlinePoliciesService.getForAirline', () => {
  it('returns the stored policy of the airline', async () => {
    const policy = stored();
    const { service, policyModel } = setup({ saved: policy });
    await expect(service.getForAirline(AIRLINE_ID)).resolves.toBe(policy);
    expect(policyModel.findOne).toHaveBeenCalledWith({ airlineId: AIRLINE_ID });
  });

  it('returns null when the airline never defined a policy', async () => {
    const { service } = setup();
    await expect(service.getForAirline(AIRLINE_ID)).resolves.toBeNull();
  });
});
