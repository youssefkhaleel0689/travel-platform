import type { Model, QueryFilter } from 'mongoose';
import { paginateArray, paginateQuery } from './paginate';

type Item = { name: string };

type Calls = {
  find?: unknown;
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
  lean: boolean;
  count?: unknown;
};

// Chainable stand-in for a Mongoose query that records every call.
class FakeQuery {
  constructor(
    private readonly calls: Calls,
    private readonly items: Item[],
  ) {}

  sort(sort: Record<string, 1 | -1>): this {
    this.calls.sort = sort;
    return this;
  }

  skip(skip: number): this {
    this.calls.skip = skip;
    return this;
  }

  limit(limit: number): this {
    this.calls.limit = limit;
    return this;
  }

  lean(): this {
    this.calls.lean = true;
    return this;
  }

  exec(): Promise<Item[]> {
    return Promise.resolve(this.items);
  }
}

// Builds a fake model; the cast to Model is done only here.
function fakeModel(items: Item[], count: number) {
  const calls: Calls = { lean: false };
  const model = {
    find(filter: unknown) {
      calls.find = filter;
      return new FakeQuery(calls, items);
    },
    countDocuments(filter: unknown) {
      calls.count = filter;
      return { exec: () => Promise.resolve(count) };
    },
  };
  return { model: model as unknown as Model<Item>, calls };
}

describe('paginateArray', () => {
  const all = Array.from({ length: 25 }, (_, i) => i + 1);

  it('returns 1..10 on page 1', () => {
    const result = paginateArray(all, 1);
    expect(result.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.meta.totalItems).toBe(25);
    expect(result.meta.totalPages).toBe(3);
  });

  it('returns 21..25 on page 3', () => {
    expect(paginateArray(all, 3).items).toEqual([21, 22, 23, 24, 25]);
  });

  it('returns no items on page 4 with correct meta', () => {
    const result = paginateArray(all, 4);
    expect(result.items).toEqual([]);
    expect(result.meta).toEqual({
      page: 4,
      pageSize: 10,
      totalItems: 25,
      totalPages: 3,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });

  it('returns no items and 0 pages for an empty array', () => {
    const result = paginateArray([], 1);
    expect(result.items).toEqual([]);
    expect(result.meta.totalPages).toBe(0);
  });

  it('does not mutate the input array', () => {
    const input = [...all];
    paginateArray(input, 2);
    expect(input).toEqual(all);
  });
});

describe('paginateQuery', () => {
  const filter: QueryFilter<Item> = { name: 'x' };

  it('skips 10 and limits to 10 on page 2', async () => {
    const { model, calls } = fakeModel([], 0);
    await paginateQuery(model, filter, { page: 2 });
    expect(calls.skip).toBe(10);
    expect(calls.limit).toBe(10);
    expect(calls.lean).toBe(true);
  });

  it('sorts by _id when no sort is given', async () => {
    const { model, calls } = fakeModel([], 0);
    await paginateQuery(model, filter, { page: 1 });
    expect(calls.sort).toEqual({ _id: 1 });
  });

  it('appends _id as the last sort key', async () => {
    const { model, calls } = fakeModel([], 0);
    await paginateQuery(model, filter, { page: 1, sort: { createdAt: -1 } });
    expect(calls.sort).toEqual({ createdAt: -1, _id: 1 });
    expect(Object.keys(calls.sort ?? {})).toEqual(['createdAt', '_id']);
  });

  it('keeps a sort that already contains _id', async () => {
    const { model, calls } = fakeModel([], 0);
    await paginateQuery(model, filter, { page: 1, sort: { _id: -1 } });
    expect(calls.sort).toEqual({ _id: -1 });
    expect(Object.keys(calls.sort ?? {})).toEqual(['_id']);
  });

  it('does not mutate the caller sort object', async () => {
    const { model, calls } = fakeModel([], 0);
    const sort: Record<string, 1 | -1> = { createdAt: -1 };
    await paginateQuery(model, filter, { page: 1, sort });
    expect(sort).toEqual({ createdAt: -1 });
    expect(calls.sort).not.toBe(sort);
  });

  it('passes the same filter to find and countDocuments', async () => {
    const { model, calls } = fakeModel([], 0);
    await paginateQuery(model, filter, { page: 1 });
    expect(calls.find).toBe(filter);
    expect(calls.count).toBe(filter);
  });

  it('returns the found items and meta from the count', async () => {
    const items: Item[] = [{ name: 'a' }, { name: 'b' }];
    const { model } = fakeModel(items, 25);
    const result = await paginateQuery(model, filter, { page: 3 });
    expect(result.items).toEqual(items);
    expect(result.meta).toEqual({
      page: 3,
      pageSize: 10,
      totalItems: 25,
      totalPages: 3,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });
});
