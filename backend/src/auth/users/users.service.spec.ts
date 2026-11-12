import { ConflictException, HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import type { PasswordService } from '../password/password.service';
import { User } from '../schemas/user.schema';
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

// Fake model and PasswordService; the casts are done only here. create() echoes the data
// back like Mongoose does, passwordHash included, so the mapper is really exercised.
function setup(options: { stored?: User | null; createError?: unknown } = {}) {
  const stored = options.stored === undefined ? user() : options.stored;

  const userModel = {
    create: jest.fn((doc: Partial<User>) =>
      options.createError !== undefined
        ? Promise.reject(options.createError)
        : Promise.resolve({ toObject: () => user({ ...doc }) }),
    ),
    findById: jest.fn(() => query(stored)),
    findOne: jest.fn(() => query(stored)),
  };
  const passwordService = {
    hash: jest.fn(() => Promise.resolve(HASH)),
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
        'createdAt',
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
