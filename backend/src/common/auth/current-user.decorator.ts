import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user';

function requestUser(context: ExecutionContext): AuthenticatedUser | undefined {
  return context.switchToHttp().getRequest<Request>().user;
}

/**
 * Factory of @CurrentUser(). Throwing cannot happen on a protected route, because the guard
 * has already rejected the request; it protects against using @CurrentUser() on a @Public
 * route, where request.user may be missing.
 */
export function currentUserFactory(
  _data: unknown,
  context: ExecutionContext,
): AuthenticatedUser {
  const user = requestUser(context);
  if (!user) {
    throw new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
  }
  return user;
}

/** Factory of @OptionalUser(): the user, or undefined for a guest. */
export function optionalUserFactory(
  _data: unknown,
  context: ExecutionContext,
): AuthenticatedUser | undefined {
  return requestUser(context);
}

/** The logged-in user on a protected route. */
export const CurrentUser = createParamDecorator(currentUserFactory);

/**
 * The logged-in user or undefined, for @Public routes that behave differently for a
 * logged-in user (for example GET /api/airlines/:id shows a deactivated airline to its
 * moderator).
 */
export const OptionalUser = createParamDecorator(optionalUserFactory);
