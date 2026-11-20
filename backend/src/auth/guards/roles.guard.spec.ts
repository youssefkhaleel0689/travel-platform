import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from './roles.guard';

// `this: void`: the methods are only read as metadata targets, never called.
class ProbeController {
  open(this: void): void {}

  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  managed(this: void): void {}
}

@Roles(Role.ADMIN)
class AdminController {
  route(this: void): void {}

  @Roles(Role.HOTEL_MODERATOR)
  overridden(this: void): void {}
}

const guard = new RolesGuard(new Reflector());

function contextFor(
  controller: object,
  handler: (this: void) => void,
  user: AuthenticatedUser | undefined,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function asRole(role: Role): AuthenticatedUser {
  return {
    userId: '6720f1c2a1b2c3d4e5f60718',
    role,
    sessionId: '6720f1c2a1b2c3d4e5f60799',
  };
}

function thrownBy(fn: () => unknown): HttpException {
  try {
    fn();
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the guard to throw');
}

describe('RolesGuard (ACC-11)', () => {
  it('allows any request on a route without @Roles', () => {
    expect(
      guard.canActivate(
        contextFor(ProbeController, ProbeController.prototype.open, undefined),
      ),
    ).toBe(true);
  });

  it.each([Role.ADMIN, Role.AIRLINE_MODERATOR])('allows %s', (role) => {
    expect(
      guard.canActivate(
        contextFor(
          ProbeController,
          ProbeController.prototype.managed,
          asRole(role),
        ),
      ),
    ).toBe(true);
  });

  it.each([Role.USER, Role.HOTEL_MODERATOR])(
    'denies %s with 403 FORBIDDEN',
    (role) => {
      const error = thrownBy(() =>
        guard.canActivate(
          contextFor(
            ProbeController,
            ProbeController.prototype.managed,
            asRole(role),
          ),
        ),
      );
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toEqual({
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
      });
    },
  );

  it('gives 401 UNAUTHENTICATED when there is no user', () => {
    const error = thrownBy(() =>
      guard.canActivate(
        contextFor(
          ProbeController,
          ProbeController.prototype.managed,
          undefined,
        ),
      ),
    );
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
  });

  it('reads @Roles from the class', () => {
    const context = (role: Role) =>
      contextFor(
        AdminController,
        AdminController.prototype.route,
        asRole(role),
      );
    expect(guard.canActivate(context(Role.ADMIN))).toBe(true);
    expect(
      thrownBy(() => guard.canActivate(context(Role.USER))).getStatus(),
    ).toBe(403);
  });

  it('lets @Roles on the method replace the class roles', () => {
    const context = (role: Role) =>
      contextFor(
        AdminController,
        AdminController.prototype.overridden,
        asRole(role),
      );
    expect(guard.canActivate(context(Role.HOTEL_MODERATOR))).toBe(true);
    expect(
      thrownBy(() => guard.canActivate(context(Role.ADMIN))).getStatus(),
    ).toBe(403);
  });
});
