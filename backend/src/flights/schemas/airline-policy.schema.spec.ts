import { Error as MongooseError, model, Types } from 'mongoose';
import { AirlinePolicy, AirlinePolicySchema } from './airline-policy.schema';

// One model for the whole file. validate() needs no database connection.
const PolicyModel = model(AirlinePolicy.name, AirlinePolicySchema);

// Returns the invalid paths.
async function errorPaths(doc: Record<string, unknown>): Promise<string[]> {
  try {
    await new PolicyModel(doc).validate();
    return [];
  } catch (error) {
    if (error instanceof MongooseError.ValidationError) {
      return Object.keys(error.errors);
    }
    throw error;
  }
}

const valid = {
  airlineId: new Types.ObjectId(),
  extraBagPrice: '25.00',
  maxExtraBagsPerPassenger: 2,
  cancellationTiers: [
    { daysBeforeDeparture: 14, refundPercentage: 100 },
    { daysBeforeDeparture: 7, refundPercentage: 50 },
  ],
  version: 1,
  updatedBy: new Types.ObjectId(),
};

describe('AirlinePolicy schema (FLT-08, FLT-09)', () => {
  it('uses the pinned collection name and one policy per airline', () => {
    expect(PolicyModel.collection.name).toBe('airlinePolicies');
    const indexes = AirlinePolicySchema.indexes();
    expect(indexes).toContainEqual([{ airlineId: 1 }, { unique: true }]);
  });

  it('accepts a full policy', async () => {
    expect(await errorPaths(valid)).toEqual([]);
  });

  it('accepts a policy with only the cancellation part (baggage not defined yet)', async () => {
    const doc = new PolicyModel({
      ...valid,
      extraBagPrice: undefined,
      maxExtraBagsPerPassenger: undefined,
    });
    await doc.validate();
    expect(doc.extraBagPrice).toBeNull();
    expect(doc.maxExtraBagsPerPassenger).toBeNull();
  });

  it('accepts a policy with only the baggage part (no tiers yet)', async () => {
    expect(await errorPaths({ ...valid, cancellationTiers: [] })).toEqual([]);
  });

  it('requires airlineId, version and updatedBy', async () => {
    const paths = await errorPaths({
      cancellationTiers: [],
    });
    expect(paths).toEqual(
      expect.arrayContaining(['airlineId', 'version', 'updatedBy']),
    );
  });

  it.each([['0'], ['0.00'], ['-5']])(
    'rejects an extra bag price of %s',
    async (price) => {
      expect(await errorPaths({ ...valid, extraBagPrice: price })).toContain(
        'extraBagPrice',
      );
    },
  );

  it('accepts 0 extra bags and rejects negative or fractional counts', async () => {
    expect(await errorPaths({ ...valid, maxExtraBagsPerPassenger: 0 })).toEqual(
      [],
    );
    expect(
      await errorPaths({ ...valid, maxExtraBagsPerPassenger: -1 }),
    ).toContain('maxExtraBagsPerPassenger');
    expect(
      await errorPaths({ ...valid, maxExtraBagsPerPassenger: 1.5 }),
    ).toContain('maxExtraBagsPerPassenger');
  });

  it('rejects a repeated threshold', async () => {
    expect(
      await errorPaths({
        ...valid,
        cancellationTiers: [
          { daysBeforeDeparture: 7, refundPercentage: 100 },
          { daysBeforeDeparture: 7, refundPercentage: 50 },
        ],
      }),
    ).toContain('cancellationTiers');
  });

  it('accepts a threshold of 0 and rejects a negative or fractional one', async () => {
    expect(
      await errorPaths({
        ...valid,
        cancellationTiers: [{ daysBeforeDeparture: 0, refundPercentage: 0 }],
      }),
    ).toEqual([]);
    const negative = await errorPaths({
      ...valid,
      cancellationTiers: [{ daysBeforeDeparture: -1, refundPercentage: 10 }],
    });
    expect(negative).toContain('cancellationTiers.0.daysBeforeDeparture');
    const fractional = await errorPaths({
      ...valid,
      cancellationTiers: [{ daysBeforeDeparture: 1.5, refundPercentage: 10 }],
    });
    expect(fractional).toContain('cancellationTiers.0.daysBeforeDeparture');
  });

  it('keeps the refund percentage between 0 and 100', async () => {
    for (const refundPercentage of [0, 100]) {
      expect(
        await errorPaths({
          ...valid,
          cancellationTiers: [{ daysBeforeDeparture: 1, refundPercentage }],
        }),
      ).toEqual([]);
    }
    for (const refundPercentage of [-1, 100.5]) {
      expect(
        await errorPaths({
          ...valid,
          cancellationTiers: [{ daysBeforeDeparture: 1, refundPercentage }],
        }),
      ).toContain('cancellationTiers.0.refundPercentage');
    }
  });

  it('rejects a version below 1', async () => {
    expect(await errorPaths({ ...valid, version: 0 })).toContain('version');
  });
});
