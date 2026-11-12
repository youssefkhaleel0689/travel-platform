import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { Public } from '../../common/auth/public.decorator';
import type { AccessTokenService } from '../tokens/access-token.service';
import type { UserProfile, UsersService } from '../users/users.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const USER_ID = '6720f1c2a1b2c3d4e5f60718';
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
}

@Public()
class PublicController {
  route(this: void): void {}
}

interface FakeRequest {
  cookies?: Record<string, unknown>;
  user?: AuthenticatedUser;
}

// Only what the guard uses; the casts are done only here.
function setup(
  options: { stored?: UserProfile | null; tokenUserId?: string } = {},
) {
  const stored = options.stored === undefined ? profile() : options.stored;
  const accessTokens = {
    verify: jest.fn((token: string) =>
      Promise.resolve(
        token === GOOD_TOKEN
          ? { userId: options.tokenUserId ?? USER_ID }
          : null,
      ),
    ),
  };
  const users = {
    findById: jest.fn((_id: string) => Promise.resolve(stored)),
  };
  const guard = new JwtAuthGuard(
    new Reflector(),
    accessTokens as unknown as AccessTokenService,
    users as unknown as UsersService,
  );
  return { guard, accessTokens, users };
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
    });
  });
});

describe('JwtAuthGuard on a protected route (ACC-04, ACC-19)', () => {
  it.each<[string, FakeRequest, { stored?: UserProfile | null }]>([
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
    expect(request.user).toEqual({ userId: USER_ID, role: Role.ADMIN });
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
