import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

// TEMPORARY until the Auth module is merged into develop.
// Once auth exists, it should put the logged-in user on `req.user`
// and the header fallback below MUST be deleted.
// As a safety net the header is ignored when NODE_ENV is "production".
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: { id?: string } }>();
    const header =
      process.env.NODE_ENV === 'production'
        ? undefined
        : req.headers['x-dev-user-id'];
    const id = req.user?.id ?? (Array.isArray(header) ? header[0] : header);
    if (!id) {
      throw new UnauthorizedException('Not authenticated');
    }
    return String(id);
  },
);
