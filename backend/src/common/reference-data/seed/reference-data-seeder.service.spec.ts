import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';
import { ReferenceDataSeeder } from './reference-data-seeder.service';
import { referenceDataset } from './reference-data.dataset';
import { ReferenceDataValidationError } from './reference-data.validation';

type Write = { collection: string; ops: unknown[] };
type Replace = {
  replaceOne: {
    filter: { _id: string };
    replacement: { _id: string };
    upsert: boolean;
  };
};

// Fake models that only have bulkWrite, so any other call would fail the test.
function buildSeeder() {
  const writes: Write[] = [];
  const fakeModel = <T>(collection: string) =>
    ({
      bulkWrite: (ops: unknown[]) => {
        writes.push({ collection, ops });
        return Promise.resolve({
          upsertedCount: ops.length,
          modifiedCount: 0,
          matchedCount: 0,
        });
      },
    }) as unknown as Model<T>;

  const seeder = new ReferenceDataSeeder(
    fakeModel('currencies'),
    fakeModel('countries'),
    fakeModel('cities'),
    fakeModel('airports'),
    fakeModel('attractions'),
  );
  return { seeder, writes };
}

describe('ReferenceDataSeeder', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes the collections in dependency order', async () => {
    const { seeder, writes } = buildSeeder();
    await seeder.seed();
    expect(writes.map((w) => w.collection)).toEqual([
      'currencies',
      'countries',
      'cities',
      'airports',
      'attractions',
    ]);
  });

  it('upserts every document by _id with replaceOne', async () => {
    const { seeder, writes } = buildSeeder();
    await seeder.seed();

    const airports = writes[3].ops as Replace[];
    expect(airports).toHaveLength(referenceDataset.airports.length);
    expect(airports[0]).toEqual({
      replaceOne: {
        filter: { _id: 'CAI' },
        replacement: {
          _id: 'CAI',
          name: 'Cairo International Airport',
          cityId: 'cairo',
          countryId: 'EG',
          timeZone: 'Africa/Cairo',
        },
        upsert: true,
      },
    });
  });

  it('logs one line per collection', async () => {
    const { seeder } = buildSeeder();
    await seeder.seed();
    expect(logSpy).toHaveBeenCalledTimes(5);
    expect(logSpy).toHaveBeenCalledWith(
      'currencies: total=7 upserted=7 modified=0 matched=0',
    );
  });

  it('writes nothing when the data is invalid', async () => {
    const { seeder, writes } = buildSeeder();
    const dataset = {
      ...referenceDataset,
      currencies: [],
    };
    await expect(seeder.seed(dataset)).rejects.toBeInstanceOf(
      ReferenceDataValidationError,
    );
    expect(writes).toEqual([]);
  });
});
