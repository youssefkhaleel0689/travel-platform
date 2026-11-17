import { NotFoundException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Role } from './auth.enums';
import type { AuthenticatedUser } from './authenticated-user';
import { findOwnedOrThrow, ownerFilter } from './ownership';

type Probe = { _id: string; userId: string; name: string };

const USER: AuthenticatedUser = {
  userId: '6720f1c2a1b2c3d4e5f60718',
  role: Role.USER,
  sessionId: '6720f1c2a1b2c3d4e5f60799',
};
const DOC_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const DOC: Probe = { _id: DOC_ID, userId: USER.userId, name: 'My trip' };

const OPTIONS = {
  notFoundCode: 'PROBE_NOT_FOUND',
  notFoundMessage: 'Probe not found',
};

// Fake model whose findOne() resolves to `found`; records the filter and select().
// The cast to Model is done only here.
function fakeModel(found: Probe | null) {
  const calls: { filter?: unknown; select: string[]; lean: boolean } = {
    select: [],
    lean: false,
  };
  const query = {
    select(fields: string) {
      calls.select.push(fields);
      return query;
    },
    lean() {
      calls.lean = true;
      return query;
    },
    exec: () => Promise.resolve(found),
  };
  const findOne = jest.fn((filter: unknown) => {
    calls.filter = filter;
    return query;
  });
  return { model: { findOne } as unknown as Model<Probe>, findOne, calls };
}

async function notFound(promise: Promise<unknown>): Promise<NotFoundException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof NotFoundException) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a 404');
}

describe('ownerFilter (ACC-11)', () => {
  it('filters on userId by default', () => {
    expect(ownerFilter(USER)).toEqual({ userId: USER.userId });
  });

  it('uses a custom owner field', () => {
    expect(ownerFilter(USER, 'authorId')).toEqual({ authorId: USER.userId });
  });

  it('never includes the role or the session', () => {
    expect(Object.keys(ownerFilter(USER))).toEqual(['userId']);
  });
});

describe('findOwnedOrThrow (ACC-11)', () => {
  it('returns the document when the user owns it, with one lean query', async () => {
    const { model, findOne, calls } = fakeModel(DOC);
    await expect(findOwnedOrThrow(model, DOC_ID, USER, OPTIONS)).resolves.toBe(
      DOC,
    );
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(calls.lean).toBe(true);
    expect(calls.select).toEqual([]);
  });

  it('puts both the id and the owner in the query filter', async () => {
    const { model, calls } = fakeModel(DOC);
    await findOwnedOrThrow(model, DOC_ID, USER, OPTIONS);
    expect(calls.filter).toEqual({ _id: DOC_ID, userId: USER.userId });
  });

  it('uses a custom ownerField in the filter', async () => {
    const { model, calls } = fakeModel(DOC);
    await findOwnedOrThrow(model, DOC_ID, USER, {
      ...OPTIONS,
      ownerField: 'travellerId',
    });
    expect(calls.filter).toEqual({ _id: DOC_ID, travellerId: USER.userId });
  });

  it('applies select when given', async () => {
    const { model, calls } = fakeModel(DOC);
    await findOwnedOrThrow(model, DOC_ID, USER, {
      ...OPTIONS,
      select: 'name',
    });
    expect(calls.select).toEqual(['name']);
  });

  it('gives 404 with the given code and message when nothing matches (missing or not yours)', async () => {
    const { model, calls } = fakeModel(null);
    const error = await notFound(
      findOwnedOrThrow(model, DOC_ID, USER, OPTIONS),
    );
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      code: 'PROBE_NOT_FOUND',
      message: 'Probe not found',
    });
    // Still filtered by the owner: someone else's document is never loaded.
    expect(calls.filter).toEqual({ _id: DOC_ID, userId: USER.userId });
  });

  it.each([
    '',
    'not-an-id',
    'twelve-chars',
    `${DOC_ID}0`,
    'zzzzzzzzzzzzzzzzzzzzzzzz',
  ])(
    'gives the same 404 for the malformed id %j without querying',
    async (id) => {
      const { model, findOne } = fakeModel(DOC);
      const error = await notFound(findOwnedOrThrow(model, id, USER, OPTIONS));
      expect(error.getResponse()).toEqual({
        code: 'PROBE_NOT_FOUND',
        message: 'Probe not found',
      });
      expect(findOne).not.toHaveBeenCalled();
    },
  );
});
