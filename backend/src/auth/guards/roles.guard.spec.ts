import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums/role.enum';
import { AuthenticatedUser } from '../types/authenticated-user';
import { RolesGuard } from './roles.guard';

function contextFor(user?: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const admin: AuthenticatedUser = {
  id: '6720f1c2a1b2c3d4e5f60001',
  email: 'admin@example.com',
  name: 'Admin',
  role: Role.ADMIN,
  sessionId: '6720f1c2a1b2c3d4e5f60002',
};

describe('RolesGuard (ACC-11)', () => {
  function guardWith(required?: Role[]): RolesGuard {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(required as never);
    return new RolesGuard(reflector);
  }

  it('allows any signed-in account when no role is required', () => {
    expect(guardWith(undefined).canActivate(contextFor(admin))).toBe(true);
    expect(guardWith([]).canActivate(contextFor(admin))).toBe(true);
  });

  it('allows an account whose role is listed', () => {
    const guard = guardWith([Role.ADMIN, Role.HOTEL_MODERATOR]);

    expect(guard.canActivate(contextFor(admin))).toBe(true);
  });

  it('rejects an account whose role is not listed', () => {
    const guard = guardWith([Role.HOTEL_MODERATOR]);

    expect(() => guard.canActivate(contextFor(admin))).toThrow(
      ForbiddenException,
    );
  });

  // Without this, forgetting AuthenticatedGuard on a route would make
  // RolesGuard pass an anonymous request straight through.
  it('rejects a request that no AuthenticatedGuard has filled in', () => {
    const guard = guardWith([Role.ADMIN]);

    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
