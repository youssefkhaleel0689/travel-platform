import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AllowWhenPasswordChangeRequired } from '../../common/auth/password-change.decorator';
import { Public } from '../../common/auth/public.decorator';
import type { SessionsService } from '../sessions/sessions.service';
import type { AccessTokenService } from '../tokens/access-token.service';
import type { UserProfile, UsersService } from '../users/users.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const USER_ID = '6720f1c2a1b2c3d4e5f60718';
const SESSION_ID = '6720f1c2a1b2c3d4e5f60799';
const GOOD_TOKEN = 'good.token.value';

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: USER_ID,
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    phone: null,
    preferredCurrency: null,
    role: Role.AIRLINE_MODERATOR,
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    createdAt: new Date('2026-11-12T10:00:00.000Z'),
    ...overrides,
  };
}

// `this: void`: the methods are only read as metadata targets, never called.
class ProtectedController {
  route(this: void): void {}

  @Public()
  publicRoute(this: void): void {}

  @AllowWhenPasswordChangeRequired()
  allowedRoute(this: void): void {}
}

@AllowWhenPasswordChangeRequired()
class AllowedController {
  route(this: void): void {}
}

@Public()
class PublicController {
  route(this: void): void {}
}

interface FakeRequest {
  cookies?: Record<string, unknown>;
  user?: AuthenticatedUser;
}

// Only what the guard uses; the casts are done only here. `sessionLive` is what
// validateForRequest resolves to (default true).
function setup(
  options: {
    stored?: UserProfile | null;
    tokenUserId?: string;
    sessionLive?: boolean;
  } = {},
) {
  const stored = options.stored === undefined ? profile() : options.stored;
  const accessTokens = {
    verify: jest.fn((token: string) =>
      Promise.resolve(
        token === GOOD_TOKEN
          ? { userId: options.tokenUserId ?? USER_ID, sessionId: SESSION_ID }
          : null,
      ),
    ),
  };
  const users = {
    findById: jest.fn((_id: string) => Promise.resolve(stored)),
  };
  const sessions = {
    validateForRequest: jest.fn((_sessionId: string, _userId: string) =>
      Promise.resolve(options.sessionLive ?? true),
    ),
  };
  const guard = new JwtAuthGuard(
    new Reflector(),
    accessTokens as unknown as AccessTokenService,
    users as unknown as UsersService,
    sessions as unknown as SessionsService,
  );
  return { guard, accessTokens, users, sessions };
}

function contextFor(
  controller: object,
  handler: (this: void) => void,
  request: FakeRequest,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const protectedRoute = (request: FakeRequest) =>
  contextFor(ProtectedController, ProtectedController.prototype.route, request);
const publicMethod = (request: FakeRequest) =>
  contextFor(
    ProtectedController,
    ProtectedController.prototype.publicRoute,
    request,
  );
const publicClass = (request: FakeRequest) =>
  contextFor(PublicController, PublicController.prototype.route, request);
const allowedMethod = (request: FakeRequest) =>
  contextFor(
    ProtectedController,
    ProtectedController.prototype.allowedRoute,
    request,
  );
const allowedClass = (request: FakeRequest) =>
  contextFor(AllowedController, AllowedController.prototype.route, request);

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the guard to reject');
}

const UNAUTHENTICATED = {
  code: 'UNAUTHENTICATED',
  message: 'Authentication required',
};

describe('JwtAuthGuard on a @Public route (ACC-04)', () => {
  it.each([
    ['@Public() on the method', publicMethod],
    ['@Public() on the class', publicClass],
  ])('lets a guest through with %s', async (_label, context) => {
    const { guard, accessTokens } = setup();
    const request: FakeRequest = {};
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(accessTokens.verify).not.toHaveBeenCalled();
  });

  it('lets a bad cookie through without a user', async () => {
    const { guard } = setup();
    const request: FakeRequest = { cookies: { access_token: 'garbage' } };
    await expect(guard.canActivate(publicMethod(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('lets a token whose session has ended through as a guest (ACC-06)', async () => {
    const { guard } = setup({ sessionLive: false });
    const request: FakeRequest = { cookies: { access_token: GOOD_TOKEN } };
    await expect(guard.canActivate(publicMethod(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('lets a suspended user through as a guest', async () => {
    const { guard } = setup({
      stored: profile({ status: UserStatus.SUSPENDED }),
    });
    const request: FakeRequest = { cookies: { access_token: GOOD_TOKEN } };
    await expect(guard.canActivate(publicMethod(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('still sets request.user from a valid cookie', async () => {
    const { guard } = setup();
    const request: FakeRequest = { cookies: { access_token: GOOD_TOKEN } };
    await expect(guard.canActivate(publicClass(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: USER_ID,
      role: Role.AIRLINE_MODERATOR,
      sessionId: SESSION_ID,
    });
  });
});

describe('JwtAuthGuard on a protected route (ACC-04, ACC-19)', () => {
  it.each<
    [
      string,
      FakeRequest,
      { stored?: UserProfile | null; sessionLive?: boolean },
    ]
  >([
    ['no cookies at all', {}, {}],
    ['no access_token cookie', { cookies: { other: 'x' } }, {}],
    ['an empty cookie', { cookies: { access_token: '' } }, {}],
    ['a cookie that is not a string', { cookies: { access_token: 42 } }, {}],
    ['an invalid token', { cookies: { access_token: 'garbage' } }, {}],
    [
      'an unknown user',
      { cookies: { access_token: GOOD_TOKEN } },
      { stored: null },
    ],
    [
      'a session that is revoked, idle or past its end (ACC-06)',
      { cookies: { access_token: GOOD_TOKEN } },
      { sessionLive: false },
    ],
    [
      'a SUSPENDED user',
      { cookies: { access_token: GOOD_TOKEN } },
      { stored: profile({ status: UserStatus.SUSPENDED }) },
    ],
    [
      'a DEACTIVATED user',
      { cookies: { access_token: GOOD_TOKEN } },
      { stored: profile({ status: UserStatus.DEACTIVATED }) },
    ],
  ])('rejects %s with the same 401', async (_label, request, options) => {
    const { guard } = setup(options);
    const error = await rejection(guard.canActivate(protectedRoute(request)));
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toEqual(UNAUTHENTICATED);
    expect(request.user).toBeUndefined();
  });

  it('sets request.user for an ACTIVE user, with the role from the database', async () => {
    const { guard, users } = setup({
      stored: profile({ role: Role.ADMIN }),
    });
    // A role elsewhere on the request is ignored: only the stored role counts.
    const request: FakeRequest & { body?: unknown } = {
      cookies: { access_token: GOOD_TOKEN },
      body: { role: Role.USER },
    };
    await expect(guard.canActivate(protectedRoute(request))).resolves.toBe(
      true,
    );
    expect(users.findById).toHaveBeenCalledWith(USER_ID);
    expect(request.user).toEqual({
      userId: USER_ID,
      role: Role.ADMIN,
      sessionId: SESSION_ID,
    });
  });

  it('checks the session named by the verified token before loading the user (ACC-06)', async () => {
    const { guard, sessions, users } = setup();
    const request: FakeRequest = { cookies: { access_token: GOOD_TOKEN } };
    await guard.canActivate(protectedRoute(request));

    expect(sessions.validateForRequest).toHaveBeenCalledTimes(1);
    expect(sessions.validateForRequest).toHaveBeenCalledWith(
      SESSION_ID,
      USER_ID,
    );
    expect(
      sessions.validateForRequest.mock.invocationCallOrder[0],
    ).toBeLessThan(users.findById.mock.invocationCallOrder[0]);
  });

  it('does not load the user when the session has ended (ACC-06)', async () => {
    const { guard, users } = setup({ sessionLive: false });
    const request: FakeRequest = { cookies: { access_token: GOOD_TOKEN } };
    await rejection(guard.canActivate(protectedRoute(request)));
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('takes sessionId only from the verified token, never from the request', async () => {
    const { guard } = setup();
    const forged = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    const request: FakeRequest & {
      body?: unknown;
      query?: unknown;
      params?: unknown;
      headers?: unknown;
    } = {
      cookies: { access_token: GOOD_TOKEN, sid: forged },
      body: { sessionId: forged, sid: forged },
      query: { sessionId: forged },
      params: { sessionId: forged },
      headers: { 'x-session-id': forged },
    };
    await guard.canActivate(protectedRoute(request));
    expect(request.user?.sessionId).toBe(SESSION_ID);
  });

  it('loads the user named by the token', async () => {
    const otherId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const { guard, users } = setup({
      tokenUserId: otherId,
      stored: profile({ id: otherId }),
    });
    const request: FakeRequest = { cookies: { access_token: GOOD_TOKEN } };
    await guard.canActivate(protectedRoute(request));
    expect(users.findById).toHaveBeenCalledWith(otherId);
    expect(request.user?.userId).toBe(otherId);
  });
});

describe('JwtAuthGuard and mustChangePassword (ACC-11)', () => {
  const MUST_CHANGE = profile({ mustChangePassword: true });
  const goodCookie = (): FakeRequest => ({
    cookies: { access_token: GOOD_TOKEN },
  });

  it('blocks a protected route with 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const { guard } = setup({ stored: MUST_CHANGE });
    const request = goodCookie();
    const error = await rejection(guard.canActivate(protectedRoute(request)));
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toEqual({
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'password change required',
    });
    expect(request.user).toBeUndefined();
  });

  it.each([
    ['on the method', allowedMethod],
    ['on the class', allowedClass],
  ])(
    'allows a route marked @AllowWhenPasswordChangeRequired() %s',
    async (_label, context) => {
      const { guard } = setup({ stored: MUST_CHANGE });
      const request = goodCookie();
      await expect(guard.canActivate(context(request))).resolves.toBe(true);
      expect(request.user).toEqual({
        userId: USER_ID,
        role: Role.AIRLINE_MODERATOR,
        sessionId: SESSION_ID,
      });
    },
  );

  it('allows a protected route when the flag is false', async () => {
    const { guard } = setup({ stored: profile({ mustChangePassword: false }) });
    await expect(guard.canActivate(protectedRoute(goodCookie()))).resolves.toBe(
      true,
    );
  });

  it.each([
    ['@Public() on the method', publicMethod],
    ['@Public() on the class', publicClass],
  ])(
    'does not affect a route with %s, and still sets request.user',
    async (_label, context) => {
      const { guard } = setup({ stored: MUST_CHANGE });
      const request = goodCookie();
      await expect(guard.canActivate(context(request))).resolves.toBe(true);
      expect(request.user?.userId).toBe(USER_ID);
    },
  );

  it.each([
    ['SUSPENDED', UserStatus.SUSPENDED],
    ['DEACTIVATED', UserStatus.DEACTIVATED],
  ])(
    'checks the flag only after the status: a %s user with the flag still gets the 401',
    async (_label, status) => {
      const { guard } = setup({
        stored: profile({ status, mustChangePassword: true }),
      });
      const error = await rejection(
        guard.canActivate(protectedRoute(goodCookie())),
      );
      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toEqual(UNAUTHENTICATED);
    },
  );

  it('checks the flag only after the session: an ended session still gets the 401', async () => {
    const { guard } = setup({ stored: MUST_CHANGE, sessionLive: false });
    const error = await rejection(
      guard.canActivate(protectedRoute(goodCookie())),
    );
    expect(error.getStatus()).toBe(401);
  });

  it('reads the flag from the user loaded on each request', async () => {
    const { guard, users } = setup({ stored: MUST_CHANGE });
    await rejection(guard.canActivate(protectedRoute(goodCookie())));

    // The flag is cleared in the database: the very next request passes.
    users.findById.mockResolvedValueOnce(
      profile({ mustChangePassword: false }),
    );
    await expect(guard.canActivate(protectedRoute(goodCookie()))).resolves.toBe(
      true,
    );
    expect(users.findById).toHaveBeenCalledTimes(2);
  });
});
