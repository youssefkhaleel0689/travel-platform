import { HttpException } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { Role, UserStatus } from '../common/auth/auth.enums';
import { accountLocked, AuthService } from './auth.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { AccessTokenService } from './tokens/access-token.service';
import type {
  CreateUserInput,
  CredentialCheck,
  UserProfile,
  UsersService,
} from './users/users.service';

const PROFILE: UserProfile = {
  id: '6720f1c2a1b2c3d4e5f60718',
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  phone: null,
  preferredCurrency: null,
  role: Role.USER,
  status: UserStatus.ACTIVE,
  mustChangePassword: false,
  suspendedAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-11-12T10:00:00.000Z'),
};

const TOKEN = 'signed.access.token';

const dto: RegisterDto = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Travel2026',
  acceptTerms: true,
};

// Fake UsersService, AccessTokenService and response; the casts are done only here.
// `credentials` is what verifyCredentials resolves to (default: the ACTIVE profile).
function setup(options: { credentials?: CredentialCheck } = {}) {
  const credentials: CredentialCheck = options.credentials ?? {
    kind: 'ok',
    profile: PROFILE,
  };
  const users = {
    create: jest.fn((_input: CreateUserInput) => Promise.resolve(PROFILE)),
    verifyCredentials: jest.fn(
      (_email: string, _password: string): Promise<CredentialCheck> =>
        Promise.resolve(credentials),
    ),
    findById: jest.fn((_id: string): Promise<UserProfile | null> =>
      Promise.resolve(PROFILE),
    ),
  };
  const accessTokens = {
    sign: jest.fn((_userId: string) => Promise.resolve(TOKEN)),
  };
  const res = {
    cookie: jest.fn(
      (_name: string, _value: string, _options: CookieOptions) => undefined,
    ),
  };
  const service = new AuthService(
    users as unknown as UsersService,
    accessTokens as unknown as AccessTokenService,
  );
  return {
    service,
    users,
    accessTokens,
    res,
    response: res as unknown as Response,
  };
}

describe('AuthService.register (ACC-01)', () => {
  it('creates a USER with the plain password and a terms timestamp', async () => {
    const { service, users, response } = setup();
    const before = Date.now();
    await service.register(dto, response);

    const input = users.create.mock.calls[0][0];
    expect(input).toEqual({
      name: 'Sara Ahmed',
      email: 'sara@example.com',
      password: 'Travel2026',
      role: Role.USER,
      termsAcceptedAt: expect.any(Date),
    });
    expect(input.termsAcceptedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('always uses the USER role, even if a role sneaks into the object', async () => {
    const { service, users, response } = setup();
    const withRole = Object.assign({}, dto, { role: Role.ADMIN });
    await service.register(withRole, response);

    expect(users.create.mock.calls[0][0].role).toBe(Role.USER);
  });

  it('logs the new user in: signs a token for its id and sets the cookie', async () => {
    const { service, accessTokens, res, response } = setup();
    await service.register(dto, response);

    expect(accessTokens.sign).toHaveBeenCalledWith(PROFILE.id);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      TOKEN,
      expect.objectContaining({ httpOnly: true, maxAge: 1_800_000 }),
    );
  });

  it('returns the created profile', async () => {
    const { service, response } = setup();
    await expect(service.register(dto, response)).resolves.toBe(PROFILE);
  });

  it('sets no cookie when the user cannot be created', async () => {
    const { service, users, accessTokens, res, response } = setup();
    users.create.mockRejectedValueOnce(new Error('duplicate'));

    await expect(service.register(dto, response)).rejects.toThrow('duplicate');
    expect(accessTokens.sign).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('AuthService.startSession (ACC-04, ACC-19)', () => {
  it('sets the signed token as the cookie and returns the profile', async () => {
    const { service, accessTokens, res, response } = setup();
    await expect(service.startSession(response, PROFILE)).resolves.toBe(
      PROFILE,
    );
    expect(accessTokens.sign).toHaveBeenCalledWith(PROFILE.id);
    expect(res.cookie.mock.calls[0][1]).toBe(TOKEN);
  });
});

const loginDto: LoginDto = {
  email: 'sara@example.com',
  password: 'Travel2026',
};

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('AuthService.login (ACC-04)', () => {
  it('checks the credentials as sent and starts a session for an ACTIVE user', async () => {
    const { service, users, accessTokens, res, response } = setup();
    const startSession = jest.spyOn(service, 'startSession');

    await expect(service.login(loginDto, response)).resolves.toBe(PROFILE);
    expect(users.verifyCredentials).toHaveBeenCalledWith(
      'sara@example.com',
      'Travel2026',
    );
    expect(startSession).toHaveBeenCalledWith(response, PROFILE);
    expect(accessTokens.sign).toHaveBeenCalledWith(PROFILE.id);
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      TOKEN,
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it.each<[string, CredentialCheck, number, object]>([
    [
      'wrong credentials',
      { kind: 'invalid' },
      401,
      { code: 'INVALID_CREDENTIALS', message: 'invalid email or password' },
    ],
    [
      'a SUSPENDED account',
      {
        kind: 'ok',
        profile: { ...PROFILE, status: UserStatus.SUSPENDED },
      },
      403,
      { code: 'ACCOUNT_SUSPENDED', message: 'account suspended' },
    ],
    [
      'a DEACTIVATED account',
      {
        kind: 'ok',
        profile: { ...PROFILE, status: UserStatus.DEACTIVATED },
      },
      403,
      { code: 'ACCOUNT_DEACTIVATED', message: 'account deactivated' },
    ],
  ])(
    'rejects %s without starting a session',
    async (_label, credentials, status, body) => {
      const { service, accessTokens, res, response } = setup({
        credentials,
      });
      const startSession = jest.spyOn(service, 'startSession');

      const error = await rejection(service.login(loginDto, response));
      expect(error.getStatus()).toBe(status);
      expect(error.getResponse()).toEqual(body);
      expect(startSession).not.toHaveBeenCalled();
      expect(accessTokens.sign).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    },
  );
});

describe('AuthService.login lockout (ACC-05)', () => {
  // The counter lives entirely in UsersService.verifyCredentials (ticket design).
  it.each<[string, CredentialCheck]>([
    ['an ACTIVE login', { kind: 'ok', profile: PROFILE }],
    [
      'a SUSPENDED login',
      { kind: 'ok', profile: { ...PROFILE, status: UserStatus.SUSPENDED } },
    ],
    ['a wrong password', { kind: 'invalid' }],
    ['a locked account', { kind: 'locked', lockedUntil: new Date() }],
  ])(
    'calls nothing on UsersService but verifyCredentials for %s',
    async (_label, credentials) => {
      const { service, users, response } = setup({ credentials });
      // Only the expected 401/403/423 are swallowed; a call to a missing method would throw
      // a TypeError and fail the test.
      await service.login(loginDto, response).catch((error: unknown) => {
        if (!(error instanceof HttpException)) {
          throw error;
        }
      });

      expect(users.verifyCredentials).toHaveBeenCalledTimes(1);
      expect(users.create).not.toHaveBeenCalled();
      expect(users.findById).not.toHaveBeenCalled();
      expect(Object.keys(users).sort()).toEqual(
        ['create', 'findById', 'verifyCredentials'].sort(),
      );
    },
  );

  it('maps locked to 423 ACCOUNT_LOCKED with details and Retry-After seconds', async () => {
    const lockedUntil = new Date(Date.now() + 14 * 60 * 1000 + 500);
    const { service, accessTokens, res, response } = setup({
      credentials: { kind: 'locked', lockedUntil },
    });

    const error = await rejection(service.login(loginDto, response));
    expect(error.getStatus()).toBe(423);
    const body = error.getResponse();
    expect(body).toEqual({
      code: 'ACCOUNT_LOCKED',
      message: 'account locked, try again later',
      details: { lockedUntil: lockedUntil.toISOString() },
      retryAfterSeconds: expect.any(Number),
    });
    const seconds =
      typeof body === 'object' && 'retryAfterSeconds' in body
        ? body.retryAfterSeconds
        : undefined;
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(900);
    // Rounded up: 14 minutes and a half second is 841 seconds.
    expect(seconds).toBe(841);

    expect(accessTokens.sign).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('accountLocked (ACC-05)', () => {
  const NOW = Date.parse('2026-11-13T10:00:00.000Z');

  it.each([
    ['15 minutes ahead', NOW + 15 * 60 * 1000, 900],
    ['a fraction of a second ahead, rounded up', NOW + 1, 1],
    ['already in the past, at least 1', NOW - 5000, 1],
  ])('gives Retry-After for a lock %s', (_label, until, seconds) => {
    const body = accountLocked(new Date(until), NOW).getResponse();
    expect(body).toMatchObject({ retryAfterSeconds: seconds });
  });
});

describe('AuthService.currentProfile (ACC-04, ACC-19)', () => {
  it('returns the profile of the logged-in user', async () => {
    const { service, users } = setup();
    await expect(service.currentProfile(PROFILE.id)).resolves.toBe(PROFILE);
    expect(users.findById).toHaveBeenCalledWith(PROFILE.id);
  });

  it('gives 401 UNAUTHENTICATED when the user no longer exists', async () => {
    const { service, users } = setup();
    users.findById.mockResolvedValueOnce(null);

    const error = await rejection(service.currentProfile(PROFILE.id));
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
  });
});
