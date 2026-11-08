import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import { AuthTokensService } from '../auth-tokens.service';
import { Role } from '../enums/role.enum';
import { UserStatus } from '../enums/user-status.enum';
import { SessionsService } from '../sessions.service';
import { UsersService } from '../users.service';
import { AuthenticatedGuard } from './authenticated.guard';

const USER_ID = '6720f1c2a1b2c3d4e5f60001';
const SESSION_ID = '6720f1c2a1b2c3d4e5f60002';

interface GuardRequest {
  cookies?: Record<string, string>;
  user?: unknown;
}

function contextFor(request: GuardRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function userDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => USER_ID },
    email: 'user@example.com',
    name: 'Test User',
    role: Role.USER,
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    ...overrides,
  };
}

describe('AuthenticatedGuard', () => {
  let tokens: jest.Mocked<Pick<AuthTokensService, 'verifyAccessToken'>>;
  let sessions: jest.Mocked<Pick<SessionsService, 'touchIfUsable'>>;
  let users: jest.Mocked<Pick<UsersService, 'findById'>>;
  let reflector: Reflector;
  let guard: AuthenticatedGuard;

  beforeEach(() => {
    tokens = {
      verifyAccessToken: jest
        .fn()
        .mockResolvedValue({ sub: USER_ID, sid: SESSION_ID, role: Role.USER }),
    };
    sessions = {
      touchIfUsable: jest
        .fn()
        .mockResolvedValue({ _id: { toString: () => SESSION_ID } }),
    };
    users = { findById: jest.fn().mockResolvedValue(userDoc()) };
    reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false as never);

    guard = new AuthenticatedGuard(
      tokens as unknown as AuthTokensService,
      sessions as unknown as SessionsService,
      users as unknown as UsersService,
      reflector,
    );
  });

  const withToken = (): GuardRequest => ({
    cookies: { [ACCESS_TOKEN_COOKIE]: 'a.valid.token' },
  });

  it('puts the account on the request, built from the database (ACC-19)', async () => {
    const request = withToken();

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: USER_ID,
      email: 'user@example.com',
      name: 'Test User',
      role: Role.USER,
      sessionId: SESSION_ID,
    });
  });

  it('reads the role from the database, not from the token', async () => {
    // A stale cookie still claiming ADMIN must not grant the admin role.
    tokens.verifyAccessToken.mockResolvedValue({
      sub: USER_ID,
      sid: SESSION_ID,
      role: Role.ADMIN,
    });
    const request = withToken();

    await guard.canActivate(contextFor(request));

    expect((request.user as { role: Role }).role).toBe(Role.USER);
  });

  it('rejects a request with no access-token cookie', async () => {
    await expect(guard.canActivate(contextFor({}))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.touchIfUsable).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token', async () => {
    tokens.verifyAccessToken.mockRejectedValue(new Error('jwt expired'));

    await expect(
      guard.canActivate(contextFor(withToken())),
    ).rejects.toMatchObject({ response: { code: 'INVALID_TOKEN' } });
  });

  // ACC-06: 30 minutes of inactivity, a logout or a password change all make
  // touchIfUsable return null.
  it('rejects a revoked or inactive session with SESSION_EXPIRED', async () => {
    sessions.touchIfUsable.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextFor(withToken())),
    ).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('records the request as activity on every call (ACC-06)', async () => {
    await guard.canActivate(contextFor(withToken()));

    expect(sessions.touchIfUsable).toHaveBeenCalledWith(SESSION_ID);
  });

  it('rejects a suspended account at once (ACC-16)', async () => {
    users.findById.mockResolvedValue(
      userDoc({ status: UserStatus.SUSPENDED }) as never,
    );

    await expect(
      guard.canActivate(contextFor(withToken())),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_SUSPENDED' } });
  });

  it('rejects a deactivated account at once (ACC-12)', async () => {
    users.findById.mockResolvedValue(
      userDoc({ status: UserStatus.DEACTIVATED }) as never,
    );

    await expect(
      guard.canActivate(contextFor(withToken())),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_DEACTIVATED' } });
  });

  it('rejects an account that owes a password change (ACC-07a)', async () => {
    users.findById.mockResolvedValue(
      userDoc({ mustChangePassword: true }) as never,
    );

    await expect(
      guard.canActivate(contextFor(withToken())),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_CHANGE_REQUIRED' } });
  });

  it('lets a pending password change reach a route marked as allowed', async () => {
    users.findById.mockResolvedValue(
      userDoc({ mustChangePassword: true }) as never,
    );
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true as never);

    await expect(
      guard.canActivate(contextFor(withToken())),
    ).resolves.toBe(true);
  });

  it('rejects a token whose account no longer exists', async () => {
    users.findById.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextFor(withToken())),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the cookie is present but empty', async () => {
    await expect(
      guard.canActivate(contextFor({ cookies: { [ACCESS_TOKEN_COOKIE]: '' } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('uses ForbiddenException for status problems, not Unauthorized', async () => {
    users.findById.mockResolvedValue(
      userDoc({ status: UserStatus.SUSPENDED }) as never,
    );

    await expect(
      guard.canActivate(contextFor(withToken())),
    ).rejects.toThrow(ForbiddenException);
  });
});
