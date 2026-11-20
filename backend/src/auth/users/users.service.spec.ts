import { ConflictException, HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import type { PasswordService } from '../password/password.service';
import { User } from '../schemas/user.schema';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './login-lockout';
import { CreateUserInput, UsersService } from './users.service';

const USER_ID = new Types.ObjectId();
const NOW = new Date('2026-11-12T10:00:00.000Z');
const HASH = '$2b$04$hashhashhashhashhashhashhashhashhashhashhashhashhashha';

function user(overrides: Partial<User> = {}): User {
  return {
    _id: USER_ID,
    name: 'Sara Ali',
    email: 'sara@example.com',
    passwordHash: HASH,
    phone: null,
    preferredCurrency: null,
    role: Role.USER,
    status: UserStatus.ACTIVE,
    termsAcceptedAt: NOW,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: false,
    temporaryPasswordIssuedAt: null,
    suspendedAt: null,
    deactivatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
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

// Fake model and PasswordService; the casts are done only here. create() echoes the data
// back like Mongoose does, passwordHash included, so the mapper is really exercised.
// `ticket` is what the reservation update returns (null: no ticket; default: the stored
// user holding ticket 1). `stored` is what findOne returns; `byId` what findById returns
// (default: `stored`). `updateMatched` is the matchedCount of every updateOne (default 1).
function setup(
  options: {
    stored?: User | null;
    createError?: unknown;
    passwordMatches?: boolean;
    ticket?: User | null;
    updateMatched?: number;
    byId?: User | null;
  } = {},
) {
  const stored = options.stored === undefined ? user() : options.stored;
  const byId = options.byId === undefined ? stored : options.byId;
  const matchedCount = options.updateMatched ?? 1;
  const ticket =
    options.ticket === undefined
      ? user({ failedLoginAttempts: 1 })
      : options.ticket;

  const userModel = {
    create: jest.fn((doc: Partial<User>) =>
      options.createError !== undefined
        ? Promise.reject(options.createError)
        : Promise.resolve({ toObject: () => user({ ...doc }) }),
    ),
    findById: jest.fn((_id: unknown) => query(byId)),
    findOne: jest.fn((_filter: { email: string }) => query(stored)),
    findOneAndUpdate: jest.fn(
      (_filter: unknown, _update: unknown, _options: unknown) => query(ticket),
    ),
    updateOne: jest.fn((_filter: unknown, _update: unknown) => ({
      exec: () =>
        Promise.resolve({ matchedCount, modifiedCount: matchedCount }),
    })),
  };
  const passwordService = {
    hash: jest.fn(() => Promise.resolve(HASH)),
    verify: jest.fn((_plain: string, _hash: string) =>
      Promise.resolve(options.passwordMatches ?? true),
    ),
    verifyDummy: jest.fn((_plain: string) => Promise.resolve(false as const)),
    // ACC-07a: used by resetPasswordToTemporary.
    generateTemporary: jest.fn(() => 'Tmpabcde12349'),
  };
  const service = new UsersService(
    userModel as unknown as Model<User>,
    passwordService as unknown as PasswordService,
  );
  return { service, userModel, passwordService };
}

const input: CreateUserInput = {
  name: 'Sara Ali',
  email: 'sara@example.com',
  password: 'abcdefg1',
  role: Role.USER,
  termsAcceptedAt: NOW,
};

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

describe('UsersService.create (ACC-01, GEN-13)', () => {
  it('hashes the plain password and stores only the hash', async () => {
    const { service, userModel, passwordService } = setup();
    await service.create(input);

    expect(passwordService.hash).toHaveBeenCalledWith('abcdefg1');
    const saved = userModel.create.mock.calls[0][0];
    expect(saved.passwordHash).toBe(HASH);
    expect(saved).not.toHaveProperty('password');
    expect(JSON.stringify(saved)).not.toContain('abcdefg1');
  });

  it('stores the email trimmed and lower-cased', async () => {
    const { service, userModel } = setup();
    await service.create({ ...input, email: '  Sara@Example.COM ' });

    expect(userModel.create.mock.calls[0][0].email).toBe('sara@example.com');
  });

  it('defaults termsAcceptedAt to null and mustChangePassword to false', async () => {
    const { service, userModel } = setup();
    await service.create({
      name: 'Admin',
      email: 'admin@example.com',
      password: 'abcdefg1',
      role: Role.ADMIN,
    });

    expect(userModel.create.mock.calls[0][0]).toMatchObject({
      termsAcceptedAt: null,
      mustChangePassword: false,
    });
  });

  it('returns a profile with a string id and without passwordHash', async () => {
    const { service } = setup();
    const profile = await service.create(input);

    expect(Object.keys(profile).sort()).toEqual(
      [
        'id',
        'name',
        'email',
        'phone',
        'preferredCurrency',
        'role',
        'status',
        'mustChangePassword',
        'emailVerifiedAt',
        'createdAt',
        // ACC-12, ACC-16: when the owner deactivated the account and when an
        // admin suspended it, so the profile and the admin list can show it.
        'suspendedAt',
        'deactivatedAt',
      ].sort(),
    );
    expect(profile.id).toBe(USER_ID.toString());
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('turns a duplicate key on email into 409 EMAIL_ALREADY_REGISTERED', async () => {
    const duplicate = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { email: 1 },
      keyValue: { email: 'sara@example.com' },
    });
    const { service } = setup({ createError: duplicate });

    const error = await failure(service.create(input));
    expect(error).toBeInstanceOf(ConflictException);
    const http = error as HttpException;
    expect(http.getStatus()).toBe(409);
    expect(http.getResponse()).toEqual({
      code: 'EMAIL_ALREADY_REGISTERED',
      message: 'email is already registered',
      errors: [{ field: 'email', messages: ['email is already registered'] }],
    });
  });

  it('rethrows a duplicate key on another index unchanged', async () => {
    const other = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { _id: 1 },
    });
    const { service } = setup({ createError: other });

    await expect(failure(service.create(input))).resolves.toBe(other);
  });

  it('rethrows any other error unchanged', async () => {
    const boom = new Error('connection lost');
    const { service } = setup({ createError: boom });

    await expect(failure(service.create(input))).resolves.toBe(boom);
  });
});

describe('UsersService.findById', () => {
  it('returns the profile of a stored user', async () => {
    const { service, userModel } = setup();
    const profile = await service.findById(USER_ID.toString());

    expect(userModel.findById).toHaveBeenCalledWith(USER_ID.toString());
    expect(profile?.id).toBe(USER_ID.toString());
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it.each(['not-an-id', 'twelve-chars'])(
    'returns null for %s without querying',
    async (id) => {
      const { service, userModel } = setup();
      await expect(service.findById(id)).resolves.toBeNull();
      expect(userModel.findById).not.toHaveBeenCalled();
    },
  );

  it('returns null when nothing is found', async () => {
    const { service } = setup({ stored: null });
    await expect(service.findById(USER_ID.toString())).resolves.toBeNull();
  });
});

describe('UsersService.findByEmail', () => {
  it('queries with the email trimmed and lower-cased', async () => {
    const { service, userModel } = setup();
    const profile = await service.findByEmail('  Sara@Example.COM ');

    expect(userModel.findOne).toHaveBeenCalledWith({
      email: 'sara@example.com',
    });
    expect(profile?.email).toBe('sara@example.com');
  });

  it('returns null when nothing is found', async () => {
    const { service } = setup({ stored: null });
    await expect(service.findByEmail('nobody@example.com')).resolves.toBeNull();
  });
});

const FUTURE = () => new Date(Date.now() + 10 * 60 * 1000);

// The query stand-in returned by a recorded call.
function chainOf(fn: jest.Mock, call = 0): ReturnType<typeof query> {
  return fn.mock.results[call].value as ReturnType<typeof query>;
}

describe('UsersService.verifyCredentials (ACC-04)', () => {
  it('reserves with the email normalized and selects the password hash', async () => {
    const { service, userModel } = setup();
    await service.verifyCredentials('  Sara@Example.COM ', 'abcdefg1');

    expect(userModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      email: 'sara@example.com',
    });
    expect(chainOf(userModel.findOneAndUpdate).selected).toEqual([
      '+passwordHash',
    ]);
  });

  it('returns ok for the right password, compared with the stored hash, and gives the ticket back', async () => {
    const { service, passwordService, userModel } = setup();
    const result = await service.verifyCredentials(
      'sara@example.com',
      'abcdefg1',
    );

    expect(passwordService.verify).toHaveBeenCalledWith('abcdefg1', HASH);
    expect(passwordService.verifyDummy).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: 'ok',
      profile: expect.objectContaining({ id: USER_ID.toString() }),
    });
    expect(userModel.updateOne).toHaveBeenCalledTimes(1);
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: USER_ID },
      { $set: { failedLoginAttempts: 0, lockedUntil: null } },
    );
  });

  it('never lets the hash or the lockout fields out', async () => {
    const { service } = setup({ ticket: user({ failedLoginAttempts: 3 }) });
    const result = await service.verifyCredentials(
      'sara@example.com',
      'abcdefg1',
    );

    expect(result.kind).toBe('ok');
    const json = JSON.stringify(result);
    expect(json).not.toContain('passwordHash');
    expect(json).not.toContain(HASH);
    expect(json).not.toContain('failedLoginAttempts');
    expect(json).not.toContain('lockedUntil');
  });

  it.each([UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
    'returns a %s profile too and resets its counter: the caller decides',
    async (status) => {
      const { service, userModel } = setup({
        ticket: user({ status, failedLoginAttempts: 2 }),
      });
      const result = await service.verifyCredentials(
        'sara@example.com',
        'abcdefg1',
      );
      expect(result.kind === 'ok' && result.profile.status).toBe(status);
      expect(userModel.updateOne).toHaveBeenCalledTimes(1);
      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: USER_ID },
        { $set: { failedLoginAttempts: 0, lockedUntil: null } },
      );
    },
  );
});

describe('UsersService.verifyCredentials lockout tickets (ACC-05)', () => {
  it('reserves a ticket with one conditional atomic update before bcrypt', async () => {
    const { service, userModel, passwordService } = setup({
      passwordMatches: false,
    });
    const before = Date.now();
    await service.verifyCredentials('sara@example.com', 'wrong-pass1');
    const after = Date.now();

    expect(userModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(userModel.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      passwordService.verify.mock.invocationCallOrder[0],
    );

    const [filter, update, options] = userModel.findOneAndUpdate.mock.calls[0];
    // No lock running, and fewer than MAX tickets taken (a missing counter counts as 0).
    expect(filter).toEqual({
      email: 'sara@example.com',
      $and: [
        {
          $or: [
            { lockedUntil: null },
            { lockedUntil: { $lte: expect.any(Date) } },
          ],
        },
        {
          $or: [
            { failedLoginAttempts: { $lt: MAX_FAILED_LOGIN_ATTEMPTS } },
            { failedLoginAttempts: { $exists: false } },
          ],
        },
      ],
    });
    // The "now" of the lock condition is the request time.
    const iso = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/.exec(JSON.stringify(filter))?.[0];
    expect(Date.parse(iso ?? '')).toBeGreaterThanOrEqual(before);
    expect(Date.parse(iso ?? '')).toBeLessThanOrEqual(after);

    // Plain operators, not a pipeline; the same update clears an expired lock.
    expect(update).toEqual({
      $inc: { failedLoginAttempts: 1 },
      $set: { lockedUntil: null },
    });
    expect(options).toEqual({ returnDocument: 'after' });
  });

  it('runs the dummy compare for an unknown email and writes nothing', async () => {
    const { service, passwordService, userModel } = setup({
      stored: null,
      ticket: null,
    });
    await expect(
      service.verifyCredentials('  Nobody@Example.com', 'abcdefg1'),
    ).resolves.toEqual({ kind: 'invalid' });

    expect(passwordService.verifyDummy).toHaveBeenCalledWith('abcdefg1');
    expect(passwordService.verify).not.toHaveBeenCalled();
    expect(userModel.findOne).toHaveBeenCalledWith({
      email: 'nobody@example.com',
    });
    expect(userModel.updateOne).not.toHaveBeenCalled();
  });

  it('returns the running lock without bcrypt when no ticket is given', async () => {
    const lockedUntil = FUTURE();
    const { service, passwordService, userModel } = setup({
      stored: user({ lockedUntil, failedLoginAttempts: 0 }),
      ticket: null,
      passwordMatches: true,
    });
    await expect(
      service.verifyCredentials('sara@example.com', 'abcdefg1'),
    ).resolves.toEqual({ kind: 'locked', lockedUntil });

    expect(passwordService.verify).not.toHaveBeenCalled();
    expect(passwordService.verifyDummy).not.toHaveBeenCalled();
    expect(userModel.updateOne).not.toHaveBeenCalled();
    // The read after a refused reservation needs only the lock.
    expect(chainOf(userModel.findOne).selected).toEqual(['lockedUntil']);
  });

  describe('all tickets taken and no lock written (a stuck last ticket heals itself)', () => {
    const EXHAUSTED = () =>
      user({
        failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
        lockedUntil: null,
      });

    it('writes the lock with one conditional update and answers with it, without bcrypt', async () => {
      const { service, passwordService, userModel } = setup({
        stored: EXHAUSTED(),
        ticket: null,
        passwordMatches: true,
        updateMatched: 1,
      });
      const before = Date.now();
      const result = await service.verifyCredentials(
        'sara@example.com',
        'abcdefg1',
      );
      const after = Date.now();

      expect(userModel.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = userModel.updateOne.mock.calls[0];
      expect(filter).toEqual({
        _id: USER_ID,
        failedLoginAttempts: { $gte: MAX_FAILED_LOGIN_ATTEMPTS },
        $or: [
          { lockedUntil: null },
          { lockedUntil: { $lte: expect.any(Date) } },
        ],
      });
      expect(update).toEqual({
        $set: { lockedUntil: expect.any(Date), failedLoginAttempts: 0 },
      });

      // The answer carries exactly the moment that was written, 15 minutes ahead.
      expect(result.kind).toBe('locked');
      const lockedUntil = result.kind === 'locked' ? result.lockedUntil : null;
      expect(update).toEqual({ $set: { lockedUntil, failedLoginAttempts: 0 } });
      const until = lockedUntil?.getTime() ?? 0;
      expect(until).toBeGreaterThanOrEqual(before + LOCKOUT_DURATION_MS);
      expect(until).toBeLessThanOrEqual(after + LOCKOUT_DURATION_MS);

      expect(userModel.findById).not.toHaveBeenCalled();
      expect(passwordService.verify).not.toHaveBeenCalled();
      expect(passwordService.verifyDummy).not.toHaveBeenCalled();
    });

    it('re-reads and answers the lock another request wrote in between', async () => {
      const lockedUntil = FUTURE();
      const { service, passwordService, userModel } = setup({
        stored: EXHAUSTED(),
        ticket: null,
        updateMatched: 0,
        byId: user({ failedLoginAttempts: 0, lockedUntil }),
      });
      await expect(
        service.verifyCredentials('sara@example.com', 'abcdefg1'),
      ).resolves.toEqual({ kind: 'locked', lockedUntil });

      expect(userModel.updateOne).toHaveBeenCalledTimes(1);
      expect(userModel.findById).toHaveBeenCalledWith(USER_ID);
      expect(chainOf(userModel.findById).selected).toEqual(['lockedUntil']);
      expect(passwordService.verify).not.toHaveBeenCalled();
    });

    it('answers locked for the full duration when a reset was written in between', async () => {
      const { service, passwordService, userModel } = setup({
        stored: EXHAUSTED(),
        ticket: null,
        updateMatched: 0,
        byId: user({ failedLoginAttempts: 0, lockedUntil: null }),
      });
      const before = Date.now();
      const result = await service.verifyCredentials(
        'sara@example.com',
        'abcdefg1',
      );
      const after = Date.now();

      expect(result.kind).toBe('locked');
      const until = result.kind === 'locked' ? result.lockedUntil.getTime() : 0;
      expect(until).toBeGreaterThanOrEqual(before + LOCKOUT_DURATION_MS);
      expect(until).toBeLessThanOrEqual(after + LOCKOUT_DURATION_MS);
      expect(userModel.updateOne).toHaveBeenCalledTimes(1);
      expect(userModel.findById).toHaveBeenCalledTimes(1);
      expect(passwordService.verify).not.toHaveBeenCalled();
    });
  });

  it.each(
    Array.from({ length: MAX_FAILED_LOGIN_ATTEMPTS - 1 }, (_, i) => i + 1),
  )(
    'answers invalid with no further write for a wrong password on ticket %i',
    async (ticketNumber) => {
      const { service, userModel } = setup({
        ticket: user({ failedLoginAttempts: ticketNumber }),
        passwordMatches: false,
      });
      await expect(
        service.verifyCredentials('sara@example.com', 'wrong-pass1'),
      ).resolves.toEqual({ kind: 'invalid' });
      expect(userModel.updateOne).not.toHaveBeenCalled();
    },
  );

  it('locks the account for 15 minutes on a wrong password with the last ticket', async () => {
    const { service, userModel } = setup({
      ticket: user({ failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS }),
      passwordMatches: false,
    });
    const before = Date.now();
    const result = await service.verifyCredentials(
      'sara@example.com',
      'wrong-pass1',
    );
    const after = Date.now();

    expect(userModel.updateOne).toHaveBeenCalledTimes(1);
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: USER_ID },
      { $set: { lockedUntil: expect.any(Date), failedLoginAttempts: 0 } },
    );
    // The 5th failure already answers locked, with the moment that was stored.
    expect(result.kind).toBe('locked');
    const lockedUntil = result.kind === 'locked' ? result.lockedUntil : null;
    expect(userModel.updateOne.mock.calls[0][1]).toEqual({
      $set: { lockedUntil, failedLoginAttempts: 0 },
    });
    const until = lockedUntil?.getTime() ?? 0;
    expect(until).toBeGreaterThanOrEqual(before + LOCKOUT_DURATION_MS);
    expect(until).toBeLessThanOrEqual(after + LOCKOUT_DURATION_MS);
  });

  it('lets the right password in on the last ticket and resets instead of locking', async () => {
    const { service, userModel } = setup({
      ticket: user({ failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS }),
      passwordMatches: true,
    });
    const result = await service.verifyCredentials(
      'sara@example.com',
      'abcdefg1',
    );
    expect(result.kind).toBe('ok');
    expect(userModel.updateOne).toHaveBeenCalledTimes(1);
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: USER_ID },
      { $set: { failedLoginAttempts: 0, lockedUntil: null } },
    );
  });
});

// ACC-05 + ACC-07a: the Leader asked whether an admin password reset should
// also clear a running lock. It should, and does: the admin has just given the
// account a new password, so making the person wait out a lockout earned by the
// old one would be pointless, and there would be no other way to clear it.
// The same applies to a password change (ACC-08) and to reactivation (ACC-16).
describe('clearing an ACC-05 lockout', () => {
  const locked = () =>
    user({
      failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      lockedUntil: new Date(NOW.getTime() + LOCKOUT_DURATION_MS),
    });

  function updateFor(userModel: {
    updateOne: jest.Mock;
  }): Record<string, unknown> {
    const [, update] = userModel.updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    return update.$set;
  }

  it('resetPasswordToTemporary clears the counter and the lock (ACC-07a)', async () => {
    const { service, userModel } = setup({ stored: locked(), byId: locked() });

    await service.resetPasswordToTemporary(USER_ID.toString(), NOW);

    const set = updateFor(userModel);
    expect(set.lockedUntil).toBeNull();
    expect(set.failedLoginAttempts).toBe(0);
    expect(set.mustChangePassword).toBe(true);
  });

  it('changeOwnPassword clears them too (ACC-08)', async () => {
    const { service, userModel } = setup({
      stored: locked(),
      byId: locked(),
      passwordMatches: true,
    });

    // The current password matches, then the new one differs from it.
    const passwords = service as unknown as {
      passwordService: { verify: jest.Mock };
    };
    passwords.passwordService.verify
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await service.changeOwnPassword(
      USER_ID.toString(),
      'OldPass123',
      'NewPass123',
    );

    const set = updateFor(userModel);
    expect(set.lockedUntil).toBeNull();
    expect(set.failedLoginAttempts).toBe(0);
  });
});
