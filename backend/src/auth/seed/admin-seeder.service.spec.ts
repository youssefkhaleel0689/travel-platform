import { ConflictException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import type {
  CreateUserInput,
  UserProfile,
  UsersService,
} from '../users/users.service';
import { AdminSeeder, DEFAULT_ADMIN_NAME } from './admin-seeder.service';

// A test-only password that passes the rules.
const PASSWORD = 'SeedAdmin2026';

const VALID_CONFIG = {
  ADMIN_EMAIL: '  Admin@Example.COM ',
  ADMIN_PASSWORD: PASSWORD,
  ADMIN_NAME: '  Site Admin  ',
};

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: '6720f1c2a1b2c3d4e5f60718',
    name: 'Site Admin',
    email: 'admin@example.com',
    phone: null,
    preferredCurrency: null,
    role: Role.ADMIN,
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    suspendedAt: null,
    deactivatedAt: null,
    createdAt: new Date('2026-11-12T10:00:00.000Z'),
    ...overrides,
  };
}

// Stub ConfigService (values from the test only, never process.env) and UsersService.
function setup(
  values: Record<string, string>,
  options: { existing?: UserProfile | null; createError?: unknown } = {},
) {
  const config = {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
  const users = {
    findByEmail: jest.fn((_email: string): Promise<UserProfile | null> =>
      Promise.resolve(options.existing ?? null),
    ),
    create: jest.fn((input: CreateUserInput) =>
      options.createError !== undefined
        ? Promise.reject(options.createError)
        : Promise.resolve(profile({ name: input.name, email: input.email })),
    ),
  };
  const seeder = new AdminSeeder(config, users as unknown as UsersService);
  return { seeder, users };
}

async function failureMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected seed() to fail');
}

describe('AdminSeeder (ACC-18)', () => {
  // Keep test output clean; the log lines themselves are checked where it matters.
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  describe('configuration (checked before any query)', () => {
    it.each<[string, Record<string, string>, string]>([
      [
        'a missing ADMIN_EMAIL',
        { ADMIN_PASSWORD: PASSWORD },
        'ADMIN_EMAIL is required',
      ],
      [
        'a blank ADMIN_EMAIL',
        { ADMIN_EMAIL: '   ', ADMIN_PASSWORD: PASSWORD },
        'ADMIN_EMAIL is required',
      ],
      [
        'an invalid ADMIN_EMAIL',
        { ADMIN_EMAIL: 'not-an-email', ADMIN_PASSWORD: PASSWORD },
        'ADMIN_EMAIL: must be a valid email',
      ],
      [
        'a missing ADMIN_PASSWORD',
        { ADMIN_EMAIL: 'admin@example.com' },
        'ADMIN_PASSWORD is required',
      ],
      [
        'an ADMIN_NAME over 100 characters',
        { ...VALID_CONFIG, ADMIN_NAME: 'a'.repeat(101) },
        'ADMIN_NAME: must be at most 100 characters',
      ],
    ])('rejects %s', async (_label, values, message) => {
      const { seeder, users } = setup(values);
      await expect(failureMessage(seeder.seed())).resolves.toBe(message);
      expect(users.findByEmail).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
    });

    it.each([
      ['WeakPassword', 'password must contain at least one digit'],
      ['12345678', 'password must contain at least one letter'],
      ['abc1', 'password must be at least 8 characters'],
    ])(
      'rejects the weak password %p with the rule, never the value',
      async (weak, rule) => {
        const { seeder, users } = setup({
          ADMIN_EMAIL: 'admin@example.com',
          ADMIN_PASSWORD: weak,
        });
        const message = await failureMessage(seeder.seed());

        expect(message).toBe(`ADMIN_PASSWORD: ${rule}`);
        expect(message).not.toContain(weak);
        expect(users.findByEmail).not.toHaveBeenCalled();
      },
    );
  });

  describe('a new admin', () => {
    it('creates an ADMIN with the normalized email and trimmed name', async () => {
      const { seeder, users } = setup(VALID_CONFIG);
      await expect(seeder.seed()).resolves.toBe('created');

      expect(users.findByEmail).toHaveBeenCalledWith('admin@example.com');
      expect(users.create).toHaveBeenCalledWith({
        name: 'Site Admin',
        email: 'admin@example.com',
        password: PASSWORD,
        role: Role.ADMIN,
        mustChangePassword: false,
        termsAcceptedAt: null,
        emailVerifiedAt: expect.any(Date),
      });
    });

    it.each([undefined, '', '   '])(
      'uses the default name when ADMIN_NAME is %p',
      async (name) => {
        const values: Record<string, string> = {
          ADMIN_EMAIL: 'admin@example.com',
          ADMIN_PASSWORD: PASSWORD,
        };
        if (name !== undefined) {
          values.ADMIN_NAME = name;
        }
        const { seeder, users } = setup(values);
        await seeder.seed();

        expect(users.create.mock.calls[0][0].name).toBe(DEFAULT_ADMIN_NAME);
      },
    );

    it('logs the email, never the password', async () => {
      const { seeder } = setup(VALID_CONFIG);
      await seeder.seed();

      const lines = logSpy.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(lines).toEqual(['Admin account created for admin@example.com']);
      expect(lines.join('\n')).not.toContain(PASSWORD);
    });
  });

  describe('an existing account', () => {
    it('leaves an existing ADMIN unchanged', async () => {
      const { seeder, users } = setup(VALID_CONFIG, { existing: profile() });
      await expect(seeder.seed()).resolves.toBe('already-exists');

      expect(users.create).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        'Admin account admin@example.com already exists',
      );
    });

    it.each([Role.USER, Role.AIRLINE_MODERATOR])(
      'refuses to promote a %s',
      async (role) => {
        const { seeder, users } = setup(VALID_CONFIG, {
          existing: profile({ role }),
        });
        const message = await failureMessage(seeder.seed());

        expect(message).toContain('ADMIN_EMAIL belongs to a non-admin account');
        expect(message).toContain('will not be promoted');
        expect(users.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('a concurrent seed (unique index conflict)', () => {
    const conflict = new ConflictException({
      code: 'EMAIL_ALREADY_REGISTERED',
      message: 'email is already registered',
    });

    it('accepts the admin created by the other run', async () => {
      const { seeder, users } = setup(VALID_CONFIG, { createError: conflict });
      users.findByEmail
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(profile());

      await expect(seeder.seed()).resolves.toBe('already-exists');
      expect(users.findByEmail).toHaveBeenCalledTimes(2);
    });

    it('rethrows when the account that won is not an admin', async () => {
      const { seeder, users } = setup(VALID_CONFIG, { createError: conflict });
      users.findByEmail
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(profile({ role: Role.USER }));

      await expect(seeder.seed()).rejects.toBe(conflict);
    });

    it('rethrows any other error unchanged', async () => {
      const boom = new Error('connection lost');
      const { seeder, users } = setup(VALID_CONFIG, { createError: boom });

      await expect(seeder.seed()).rejects.toBe(boom);
      expect(users.findByEmail).toHaveBeenCalledTimes(1);
    });
  });
});
