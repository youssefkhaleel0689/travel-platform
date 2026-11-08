import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthenticatedUser, RequestWithUser } from '../types/authenticated-user';

/**
 * Injects the signed-in account into a controller method:
 *
 *   @Get('me')
 *   me(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * The route must be behind AuthenticatedGuard. If it is not, this throws a 500
 * instead of handing the controller `undefined`, which would otherwise look
 * like a missing user and could silently skip an ownership check.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new InternalServerErrorException(
        'CurrentUser used on a route without AuthenticatedGuard',
      );
    }
    return request.user;
  },
);
