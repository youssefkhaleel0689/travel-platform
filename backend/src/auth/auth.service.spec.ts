import { HttpException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { Role, UserStatus } from '../common/auth/auth.enums';
import { accountLocked, AuthService } from './auth.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type {
  RotatedSession,
  SessionsService,
} from './sessions/sessions.service';
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
  createdAt: new Date('2026-11-12T10:00:00.000Z'),
};

const TOKEN = 'signed.access.token';
const SESSION_ID = '6720f1c2a1b2c3d4e5f60799';
const REFRESH_TOKEN = 'refresh-token-from-the-session-service-0123';
// Far enough ahead that the refresh cookie's maxAge is positive whatever the clock says.
const SESSION_EXPIRES_AT = new Date(Date.now() + 5 * 60 * 60 * 1000);
const OLD_REFRESH_TOKEN = 'the-refresh-token-sent-by-the-browser-01234';
const ROTATED: RotatedSession = {
  sessionId: SESSION_ID,
  userId: PROFILE.id,
  refreshToken: 'the-new-refresh-token-after-rotation-567890',
  expiresAt: SESSION_EXPIRES_AT,
};

const dto: RegisterDto = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Travel2026',
  acceptTerms: true,
};

// Fake UsersService, AccessTokenService, SessionsService and response; the casts are done
// only here.
// `credentials` is what verifyCredentials resolves to (default: the ACTIVE profile);
// `rotated` what SessionsService.rotate resolves to (default: a successful rotation);
// `stored` what UsersService.findById resolves to (default: the ACTIVE profile).
function setup(
  options: {
    credentials?: CredentialCheck;
    rotated?: RotatedSession | null;
    stored?: UserProfile | null;
  } = {},
) {
  const credentials: CredentialCheck = options.credentials ?? {
    kind: 'ok',
    profile: PROFILE,
  };
  const rotated = options.rotated === undefined ? ROTATED : options.rotated;
  const stored = options.stored === undefined ? PROFILE : options.stored;
  const users = {
    create: jest.fn((_input: CreateUserInput) => Promise.resolve(PROFILE)),
    verifyCredentials: jest.fn(
      (_email: string, _password: string): Promise<CredentialCheck> =>
        Promise.resolve(credentials),
    ),
    findById: jest.fn((_id: string): Promise<UserProfile | null> =>
      Promise.resolve(stored),
    ),
  };
  const accessTokens = {
    sign: jest.fn((_userId: string, _sessionId: string) =>
      Promise.resolve(TOKEN),
    ),
  };
  const sessions = {
    create: jest.fn((_userId: string) =>
      Promise.resolve({
        sessionId: SESSION_ID,
        refreshToken: REFRESH_TOKEN,
        expiresAt: SESSION_EXPIRES_AT,
      }),
    ),
    rotate: jest.fn((_token: string): Promise<RotatedSession | null> =>
      Promise.resolve(rotated),
    ),
    revoke: jest.fn((_sessionId: string) => Promise.resolve()),
  };
  const res = {
    cookie: jest.fn(
      (_name: string, _value: string, _options: CookieOptions) => undefined,
    ),
    clearCookie: jest.fn((_name: string, _options: CookieOptions) => undefined),
  };
  const service = new AuthService(
    users as unknown as UsersService,
    accessTokens as unknown as AccessTokenService,
    sessions as unknown as SessionsService,
  );
  return {
    service,
    users,
    accessTokens,
    sessions,
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

  it('logs the new user in: starts a session, signs a token for it and sets both cookies', async () => {
    const { service, accessTokens, sessions, res, response } = setup();
    await service.register(dto, response);

    expect(sessions.create).toHaveBeenCalledWith(PROFILE.id);
    expect(accessTokens.sign).toHaveBeenCalledWith(PROFILE.id, SESSION_ID);
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      TOKEN,
      expect.objectContaining({ httpOnly: true, maxAge: 1_800_000 }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      REFRESH_TOKEN,
      expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
    );
  });

  it('returns the created profile', async () => {
    const { service, response } = setup();
    await expect(service.register(dto, response)).resolves.toBe(PROFILE);
  });

  it('starts no session and sets no cookie when the user cannot be created', async () => {
    const { service, users, accessTokens, sessions, res, response } = setup();
    users.create.mockRejectedValueOnce(new Error('duplicate'));

    await expect(service.register(dto, response)).rejects.toThrow('duplicate');
    expect(sessions.create).not.toHaveBeenCalled();
    expect(accessTokens.sign).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('AuthService.startSession (ACC-04, ACC-06, ACC-19)', () => {
  it('creates the session first, then signs the token for that session', async () => {
    const { service, accessTokens, sessions, response } = setup();
    await expect(service.startSession(response, PROFILE)).resolves.toBe(
      PROFILE,
    );
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(sessions.create).toHaveBeenCalledWith(PROFILE.id);
    expect(accessTokens.sign).toHaveBeenCalledWith(PROFILE.id, SESSION_ID);
    expect(sessions.create.mock.invocationCallOrder[0]).toBeLessThan(
      accessTokens.sign.mock.invocationCallOrder[0],
    );
  });

  it('sets the access token and the refresh token cookies', async () => {
    const { service, res, response } = setup();
    const before = Date.now();
    await service.startSession(response, PROFILE);
    const after = Date.now();

    expect(res.cookie).toHaveBeenCalledTimes(2);
    const access = res.cookie.mock.calls.find((c) => c[0] === 'access_token');
    expect(access?.[1]).toBe(TOKEN);

    const refresh = res.cookie.mock.calls.find((c) => c[0] === 'refresh_token');
    expect(refresh?.[1]).toBe(REFRESH_TOKEN);
    expect(refresh?.[2]).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/auth',
    });
    // Until the session's expiresAt, in whole seconds.
    const maxAge = refresh?.[2].maxAge ?? -1;
    expect(maxAge % 1000).toBe(0);
    expect(maxAge).toBeLessThanOrEqual(SESSION_EXPIRES_AT.getTime() - before);
    expect(maxAge).toBeGreaterThan(SESSION_EXPIRES_AT.getTime() - after - 1000);
  });

  it('puts the refresh token in its cookie only, never in the returned profile', async () => {
    const { service, response } = setup();
    const returned = await service.startSession(response, PROFILE);
    expect(JSON.stringify(returned)).not.toContain(REFRESH_TOKEN);
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
    expect(accessTokens.sign).toHaveBeenCalledWith(PROFILE.id, SESSION_ID);
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
      const { service, accessTokens, sessions, res, response } = setup({
        credentials,
      });
      const startSession = jest.spyOn(service, 'startSession');

      const error = await rejection(service.login(loginDto, response));
      expect(error.getStatus()).toBe(status);
      expect(error.getResponse()).toEqual(body);
      expect(startSession).not.toHaveBeenCalled();
      // ACC-06: a session is created only after a fully successful login.
      expect(sessions.create).not.toHaveBeenCalled();
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
    const { service, accessTokens, sessions, res, response } = setup({
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

    expect(sessions.create).not.toHaveBeenCalled();
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

// A request carrying only the given cookies; the cast is done only here.
function requestWith(cookies?: Record<string, unknown>): Request {
  return { cookies } as unknown as Request;
}

describe('AuthService.refresh (ACC-06)', () => {
  it('rotates the refresh token, checks the user, signs for the same session and sets both cookies', async () => {
    const { service, users, sessions, accessTokens, res, response } = setup();
    const before = Date.now();

    await expect(
      service.refresh(
        requestWith({ refresh_token: OLD_REFRESH_TOKEN }),
        response,
      ),
    ).resolves.toBe(PROFILE);

    expect(sessions.rotate).toHaveBeenCalledTimes(1);
    expect(sessions.rotate).toHaveBeenCalledWith(OLD_REFRESH_TOKEN);
    expect(users.findById).toHaveBeenCalledWith(ROTATED.userId);
    // Same session: the sid does not change on refresh.
    expect(accessTokens.sign).toHaveBeenCalledWith(PROFILE.id, SESSION_ID);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(sessions.revoke).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();

    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      TOKEN,
      expect.objectContaining({ httpOnly: true, path: '/', maxAge: 1_800_000 }),
    );
    const refresh = res.cookie.mock.calls.find((c) => c[0] === 'refresh_token');
    expect(refresh?.[1]).toBe(ROTATED.refreshToken);
    expect(refresh?.[2]).toMatchObject({ httpOnly: true, path: '/api/auth' });
    // Until the session's expiresAt, not a fresh lifetime.
    expect(refresh?.[2].maxAge ?? 0).toBeLessThanOrEqual(
      SESSION_EXPIRES_AT.getTime() - before,
    );
  });

  it('never puts either token in the returned profile', async () => {
    const { service, response } = setup();
    const returned = await service.refresh(
      requestWith({ refresh_token: OLD_REFRESH_TOKEN }),
      response,
    );
    const json = JSON.stringify(returned);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(ROTATED.refreshToken);
    expect(json).not.toContain(OLD_REFRESH_TOKEN);
  });

  it('gives 401 and clears both cookies when the rotation fails', async () => {
    const { service, users, sessions, accessTokens, res, response } = setup({
      rotated: null,
    });

    const error = await rejection(
      service.refresh(
        requestWith({ refresh_token: OLD_REFRESH_TOKEN }),
        response,
      ),
    );
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
    expect(res.clearCookie.mock.calls.map((c) => c[0]).sort()).toEqual([
      'access_token',
      'refresh_token',
    ]);
    expect(res.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({ path: '/api/auth' }),
    );
    expect(res.cookie).not.toHaveBeenCalled();
    expect(users.findById).not.toHaveBeenCalled();
    expect(sessions.revoke).not.toHaveBeenCalled();
    expect(accessTokens.sign).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown> | undefined]>([
    ['no cookies at all', undefined],
    ['no refresh_token cookie', { access_token: 'x' }],
    ['a refresh_token that is not a string', { refresh_token: 42 }],
  ])('passes an empty token to rotate for %s', async (_label, cookies) => {
    const { service, sessions, response } = setup({ rotated: null });
    await rejection(service.refresh(requestWith(cookies), response));
    expect(sessions.rotate).toHaveBeenCalledWith('');
  });

  it.each<[string, UserProfile | null]>([
    ['an unknown user', null],
    ['a SUSPENDED user', { ...PROFILE, status: UserStatus.SUSPENDED }],
    ['a DEACTIVATED user', { ...PROFILE, status: UserStatus.DEACTIVATED }],
  ])(
    'revokes the session, gives the same 401 and clears both cookies for %s',
    async (_label, stored) => {
      const { service, sessions, accessTokens, res, response } = setup({
        stored,
      });

      const error = await rejection(
        service.refresh(
          requestWith({ refresh_token: OLD_REFRESH_TOKEN }),
          response,
        ),
      );
      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toEqual({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
      expect(sessions.revoke).toHaveBeenCalledTimes(1);
      expect(sessions.revoke).toHaveBeenCalledWith(SESSION_ID);
      expect(res.clearCookie).toHaveBeenCalledTimes(2);
      expect(res.cookie).not.toHaveBeenCalled();
      expect(accessTokens.sign).not.toHaveBeenCalled();
    },
  );

  it.each<[string, NonNullable<Parameters<typeof setup>[0]>]>([
    ['a successful refresh', {}],
    ['a failed rotation', { rotated: null }],
    [
      'a suspended user',
      { stored: { ...PROFILE, status: UserStatus.SUSPENDED } },
    ],
  ])('never touches the login lockout for %s', async (_label, options) => {
    const { service, users, response } = setup(options);
    await service
      .refresh(requestWith({ refresh_token: OLD_REFRESH_TOKEN }), response)
      .catch((error: unknown) => {
        if (!(error instanceof HttpException)) {
          throw error;
        }
      });
    // verifyCredentials holds the whole lockout (ACC-05); refresh checks no password.
    expect(users.verifyCredentials).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
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
