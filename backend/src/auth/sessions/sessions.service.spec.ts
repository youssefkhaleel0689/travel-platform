import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { createHash } from 'node:crypto';
import {
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_ACTIVITY_WRITE_INTERVAL_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from './session.constants';
import { Session } from './session.schema';
import { SessionsService } from './sessions.service';

const SESSION_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();
const NOW = new Date('2026-11-17T10:00:00.000Z');
const IDLE_CUTOFF = new Date(NOW.getTime() - SESSION_IDLE_TIMEOUT_MS);
const WRITE_BEFORE = new Date(
  NOW.getTime() - SESSION_ACTIVITY_WRITE_INTERVAL_MS,
);
// 43 base64url characters, like a real token.
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_x';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    _id: SESSION_ID,
    userId: USER_ID,
    refreshTokenHash: sha256(TOKEN),
    lastActivityAt: NOW,
    revokedAt: null,
    expiresAt: new Date(NOW.getTime() + SESSION_ABSOLUTE_LIFETIME_MS),
    createdAt: NOW,
    ...overrides,
  };
}

// A query stand-in: select(), lean() and exec() resolve to the given result. The
// select() arguments are recorded so a test can check which fields were requested.
function query<R>(result: R) {
  const chain = {
    selected: [] as string[],
    select: (fields: string) => {
      chain.selected.push(fields);
      return chain;
    },
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

// Fake model, given to the service as its Session model provider. `found` is what findOne and findOneAndUpdate
// return (null: no match); `modified` is the modifiedCount of updateMany.
async function setup(
  options: { found?: Session | null; modified?: number } = {},
) {
  const found = options.found === undefined ? session() : options.found;
  const sessionModel = {
    create: jest.fn((doc: Partial<Session>) =>
      Promise.resolve({ _id: SESSION_ID, ...doc }),
    ),
    findOne: jest.fn((_filter: unknown) => query(found)),
    findOneAndUpdate: jest.fn(
      (_filter: unknown, _update: unknown, _options: unknown) => query(found),
    ),
    updateOne: jest.fn((_filter: unknown, _update: unknown) => ({
      exec: () => Promise.resolve({ matchedCount: 1, modifiedCount: 1 }),
    })),
    updateMany: jest.fn((_filter: unknown, _update: unknown) => ({
      exec: () =>
        Promise.resolve({
          matchedCount: options.modified ?? 0,
          modifiedCount: options.modified ?? 0,
        }),
    })),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      SessionsService,
      { provide: getModelToken(Session.name), useValue: sessionModel },
    ],
  }).compile();
  return { service: moduleRef.get(SessionsService), sessionModel };
}

// The query stand-in returned by a recorded call.
function chainOf(fn: jest.Mock, call = 0): ReturnType<typeof query> {
  return fn.mock.results[call].value as ReturnType<typeof query>;
}

const BAD_IDS = ['', 'not-an-id', 'twelve-chars', `${SESSION_ID.toString()}0`];
const BAD_TOKENS = [
  '',
  'short',
  `${TOKEN}A`,
  `${TOKEN.slice(0, 42)}=`,
  `${TOKEN.slice(0, 42)}+`,
];

describe('SessionsService.create (ACC-06)', () => {
  it('stores only the SHA-256 hash of a fresh 43-character base64url token', async () => {
    const { service, sessionModel } = await setup();
    const created = await service.create(USER_ID.toString(), NOW);

    expect(created.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.sessionId).toBe(SESSION_ID.toString());

    expect(sessionModel.create).toHaveBeenCalledTimes(1);
    const stored = sessionModel.create.mock.calls[0][0];
    expect(stored.refreshTokenHash).toBe(sha256(created.refreshToken));
    expect(JSON.stringify(stored)).not.toContain(created.refreshToken);
    expect(created).not.toHaveProperty('refreshTokenHash');
  });

  it('starts the session now and ends it after the absolute lifetime', async () => {
    const { service, sessionModel } = await setup();
    const created = await service.create(USER_ID.toString(), NOW);

    const expiresAt = new Date(NOW.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);
    expect(created.expiresAt).toEqual(expiresAt);
    expect(sessionModel.create.mock.calls[0][0]).toEqual({
      userId: USER_ID.toString(),
      refreshTokenHash: expect.any(String),
      lastActivityAt: NOW,
      revokedAt: null,
      expiresAt,
    });
  });

  it('gives every session a different token', async () => {
    const { service } = await setup();
    const a = await service.create(USER_ID.toString(), NOW);
    const b = await service.create(USER_ID.toString(), NOW);
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });
});

describe('SessionsService.validateForRequest (ACC-06)', () => {
  it.each([
    ...BAD_IDS.map((id) => [id, USER_ID.toString()]),
    ...BAD_IDS.map((id) => [SESSION_ID.toString(), id]),
  ])(
    'returns false for session %j and user %j without querying',
    async (sessionId, userId) => {
      const { service, sessionModel } = await setup();
      await expect(
        service.validateForRequest(sessionId, userId, NOW),
      ).resolves.toBe(false);
      expect(sessionModel.findOne).not.toHaveBeenCalled();
    },
  );

  it('looks the session up with every validity condition in one query', async () => {
    const { service, sessionModel } = await setup();
    await service.validateForRequest(
      SESSION_ID.toString(),
      USER_ID.toString(),
      NOW,
    );

    expect(sessionModel.findOne).toHaveBeenCalledTimes(1);
    expect(sessionModel.findOne).toHaveBeenCalledWith({
      _id: SESSION_ID.toString(),
      userId: USER_ID.toString(),
      revokedAt: null,
      expiresAt: { $gt: NOW },
      lastActivityAt: { $gt: IDLE_CUTOFF },
    });
    expect(chainOf(sessionModel.findOne).selected).toEqual(['lastActivityAt']);
  });

  it('returns false when no live session matches', async () => {
    const { service, sessionModel } = await setup({ found: null });
    await expect(
      service.validateForRequest(
        SESSION_ID.toString(),
        USER_ID.toString(),
        NOW,
      ),
    ).resolves.toBe(false);
    expect(sessionModel.updateOne).not.toHaveBeenCalled();
  });

  it('returns true without a write when activity was recorded less than a minute ago', async () => {
    const { service, sessionModel } = await setup({
      found: session({ lastActivityAt: new Date(WRITE_BEFORE.getTime() + 1) }),
    });
    await expect(
      service.validateForRequest(
        SESSION_ID.toString(),
        USER_ID.toString(),
        NOW,
      ),
    ).resolves.toBe(true);
    expect(sessionModel.updateOne).not.toHaveBeenCalled();
  });

  it('records activity with one conditional write when it is a minute old or more', async () => {
    const { service, sessionModel } = await setup({
      found: session({ lastActivityAt: WRITE_BEFORE }),
    });
    await expect(
      service.validateForRequest(
        SESSION_ID.toString(),
        USER_ID.toString(),
        NOW,
      ),
    ).resolves.toBe(true);

    expect(sessionModel.updateOne).toHaveBeenCalledTimes(1);
    // The filter repeats the validity conditions, so parallel requests write at most once
    // and an ended session is never revived.
    expect(sessionModel.updateOne).toHaveBeenCalledWith(
      {
        _id: SESSION_ID.toString(),
        userId: USER_ID.toString(),
        revokedAt: null,
        expiresAt: { $gt: NOW },
        lastActivityAt: { $gt: IDLE_CUTOFF, $lte: WRITE_BEFORE },
      },
      { $set: { lastActivityAt: NOW } },
    );
  });
});

describe('SessionsService.rotate (ACC-06)', () => {
  it.each(BAD_TOKENS)(
    'returns null for the malformed token %j without querying',
    async (token) => {
      const { service, sessionModel } = await setup();
      await expect(service.rotate(token, NOW)).resolves.toBeNull();
      expect(sessionModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('swaps the token hash in one atomic update limited to live sessions', async () => {
    const { service, sessionModel } = await setup();
    const rotated = await service.rotate(TOKEN, NOW);

    expect(sessionModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] =
      sessionModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({
      refreshTokenHash: sha256(TOKEN),
      revokedAt: null,
      expiresAt: { $gt: NOW },
      lastActivityAt: { $gt: IDLE_CUTOFF },
    });
    expect(options).toEqual({ returnDocument: 'after' });
    expect(update).toEqual({
      $set: {
        refreshTokenHash: sha256(rotated?.refreshToken ?? ''),
        lastActivityAt: NOW,
      },
    });
  });

  it('returns a new, different token with the session ids as strings', async () => {
    const { service } = await setup();
    const rotated = await service.rotate(TOKEN, NOW);

    expect(rotated).toEqual({
      sessionId: SESSION_ID.toString(),
      userId: USER_ID.toString(),
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: session().expiresAt,
    });
    expect(rotated?.refreshToken).not.toBe(TOKEN);
    expect(rotated).not.toHaveProperty('refreshTokenHash');
  });

  it('returns null when no live session holds the token', async () => {
    const { service } = await setup({ found: null });
    await expect(service.rotate(TOKEN, NOW)).resolves.toBeNull();
  });
});

describe('SessionsService.revoke (ACC-06)', () => {
  it('revokes a live session by id', async () => {
    const { service, sessionModel } = await setup();
    await service.revoke(SESSION_ID.toString(), NOW);

    expect(sessionModel.updateOne).toHaveBeenCalledTimes(1);
    expect(sessionModel.updateOne).toHaveBeenCalledWith(
      { _id: SESSION_ID.toString(), revokedAt: null },
      { $set: { revokedAt: NOW } },
    );
  });

  it.each(BAD_IDS)('is a no-op for the id %j', async (id) => {
    const { service, sessionModel } = await setup();
    await expect(service.revoke(id, NOW)).resolves.toBeUndefined();
    expect(sessionModel.updateOne).not.toHaveBeenCalled();
  });
});

describe('SessionsService.revokeByRefreshToken (ACC-06)', () => {
  it('revokes the live session holding the token, found by its hash', async () => {
    const { service, sessionModel } = await setup();
    await service.revokeByRefreshToken(TOKEN, NOW);

    expect(sessionModel.updateOne).toHaveBeenCalledTimes(1);
    expect(sessionModel.updateOne).toHaveBeenCalledWith(
      { refreshTokenHash: sha256(TOKEN), revokedAt: null },
      { $set: { revokedAt: NOW } },
    );
  });

  it.each(BAD_TOKENS)('is a no-op for the token %j', async (token) => {
    const { service, sessionModel } = await setup();
    await expect(
      service.revokeByRefreshToken(token, NOW),
    ).resolves.toBeUndefined();
    expect(sessionModel.updateOne).not.toHaveBeenCalled();
  });
});

describe('SessionsService.revokeAllSessions (ACC-06, for ACC-07a, ACC-08, ACC-12, ACC-16)', () => {
  const OTHER_SESSION_ID = new Types.ObjectId().toString();

  it('revokes every live session of the user and returns modifiedCount', async () => {
    const { service, sessionModel } = await setup({ modified: 3 });
    await expect(
      service.revokeAllSessions(USER_ID.toString(), { now: NOW }),
    ).resolves.toBe(3);

    expect(sessionModel.updateMany).toHaveBeenCalledTimes(1);
    expect(sessionModel.updateMany).toHaveBeenCalledWith(
      { userId: USER_ID.toString(), revokedAt: null },
      { $set: { revokedAt: NOW } },
    );
  });

  it('defaults now to the current time', async () => {
    const { service, sessionModel } = await setup();
    const before = Date.now();
    await service.revokeAllSessions(USER_ID.toString());
    const after = Date.now();

    const update = sessionModel.updateMany.mock.calls[0][1] as {
      $set: { revokedAt: Date };
    };
    expect(update.$set.revokedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(update.$set.revokedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('keeps the given session open (ACC-08: the device that changed the password)', async () => {
    const { service, sessionModel } = await setup({ modified: 2 });
    await expect(
      service.revokeAllSessions(USER_ID.toString(), {
        exceptSessionId: OTHER_SESSION_ID,
        now: NOW,
      }),
    ).resolves.toBe(2);

    expect(sessionModel.updateMany).toHaveBeenCalledWith(
      {
        userId: USER_ID.toString(),
        revokedAt: null,
        _id: { $ne: OTHER_SESSION_ID },
      },
      { $set: { revokedAt: NOW } },
    );
  });

  it.each(BAD_IDS)(
    'ignores the malformed exceptSessionId %j and revokes every session',
    async (exceptSessionId) => {
      const { service, sessionModel } = await setup({ modified: 3 });
      await expect(
        service.revokeAllSessions(USER_ID.toString(), {
          exceptSessionId,
          now: NOW,
        }),
      ).resolves.toBe(3);

      expect(sessionModel.updateMany).toHaveBeenCalledWith(
        { userId: USER_ID.toString(), revokedAt: null },
        { $set: { revokedAt: NOW } },
      );
    },
  );

  it.each(BAD_IDS)(
    'returns 0 for the user id %j without querying',
    async (id) => {
      const { service, sessionModel } = await setup();
      await expect(
        service.revokeAllSessions(id, { exceptSessionId: OTHER_SESSION_ID }),
      ).resolves.toBe(0);
      expect(sessionModel.updateMany).not.toHaveBeenCalled();
    },
  );
});
