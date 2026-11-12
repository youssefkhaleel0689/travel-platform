import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from './auth.enums';
import type { AuthenticatedUser } from './authenticated-user';
import {
  currentUserFactory,
  optionalUserFactory,
} from './current-user.decorator';
import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { Roles, ROLES_KEY } from './roles.decorator';

// `this: void`: the methods are only read as metadata targets, never called.
class ProbeController {
  @Public()
  open(this: void): void {}

  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  managed(this: void): void {}

  plain(this: void): void {}
}

const reflector = new Reflector();
const proto = ProbeController.prototype;

const USER: AuthenticatedUser = {
  userId: '6720f1c2a1b2c3d4e5f60718',
  role: Role.USER,
};

// Only what the factories use: switchToHttp().getRequest(). The cast is done only here.
function contextWith(user: AuthenticatedUser | undefined): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('@Public()', () => {
  it('marks the route as public', () => {
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, proto.open)).toBe(true);
  });

  it('leaves other routes unmarked', () => {
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, proto.plain)).toBeUndefined();
  });
});

describe('@Roles()', () => {
  it('stores the given roles', () => {
    expect(reflector.get<Role[]>(ROLES_KEY, proto.managed)).toEqual([
      Role.ADMIN,
      Role.AIRLINE_MODERATOR,
    ]);
  });

  it('throws when no role is given', () => {
    expect(() => Roles()).toThrow('@Roles() needs at least one role');
  });
});

describe('@CurrentUser()', () => {
  it('returns request.user', () => {
    expect(currentUserFactory(undefined, contextWith(USER))).toBe(USER);
  });

  it('throws 401 UNAUTHENTICATED when request.user is missing', () => {
    const error = thrownBy(() =>
      currentUserFactory(undefined, contextWith(undefined)),
    );
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    expect(http.getStatus()).toBe(401);
    expect(http.getResponse()).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
  });
});

describe('@OptionalUser()', () => {
  it('returns request.user when there is one', () => {
    expect(optionalUserFactory(undefined, contextWith(USER))).toBe(USER);
  });

  it('returns undefined for a guest', () => {
    expect(
      optionalUserFactory(undefined, contextWith(undefined)),
    ).toBeUndefined();
  });
});
