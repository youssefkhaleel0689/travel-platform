import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { UsersService } from '../users/users.service';

/** ACC-02: applied to booking routes; a no-op unless verification is enabled. */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (request.user) {
      await this.users.assertCanBook(request.user.userId);
    }
    return true;
  }
}
