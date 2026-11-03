import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { ErrorResponseDto, FieldErrorDto } from '../dto/error-response.dto';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  500: 'INTERNAL_ERROR',
};

// Nest's router 404 text, e.g. "Cannot GET /api/nope?token=abc".
const ROUTER_NOT_FOUND = /^Cannot [A-Z]+ \//;

type ErrorBody = Omit<ErrorResponseDto, 'path' | 'timestamp' | 'error'>;

interface MongoDuplicateKeyError {
  code: 11000;
  keyValue?: Record<string, unknown>;
  keyPattern?: Record<string, unknown>;
}

function isDuplicateKeyError(e: unknown): e is MongoDuplicateKeyError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 11000
  );
}

// Mongoose CastError (e.g. an invalid ObjectId), detected without importing mongoose.
function isCastError(e: unknown): e is { name: 'CastError'; path: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'CastError' &&
    typeof (e as { path?: unknown }).path === 'string'
  );
}

// Every error leaves the API in the shape of ErrorResponseDto.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const path = request.originalUrl.split('?')[0];

    const body = this.toErrorBody(exception, `${request.method} ${path}`);

    const payload: ErrorResponseDto = {
      statusCode: body.statusCode,
      code: body.code,
      error: STATUS_CODES[body.statusCode] ?? 'Error',
      message: body.message,
      ...(body.errors && { errors: body.errors }),
      path,
      timestamp: new Date().toISOString(),
    };
    response.status(body.statusCode).json(payload);
  }

  private toErrorBody(exception: unknown, route: string): ErrorBody {
    if (exception instanceof HttpException) {
      const body = this.fromHttpException(exception);
      if (body.statusCode >= 500) {
        this.logger.error(
          `HttpException ${body.statusCode} on ${route}`,
          exception.stack,
        );
      }
      return body;
    }

    if (isCastError(exception)) {
      // Field name only: error.value is user input and is never echoed or logged.
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_VALUE',
        message: `Invalid value for "${exception.path}"`,
        errors: [{ field: exception.path, messages: ['invalid value'] }],
      };
    }

    if (isDuplicateKeyError(exception)) {
      // Field names only: the duplicated values may be personal data.
      const fields = Object.keys(
        exception.keyValue ?? exception.keyPattern ?? {},
      );
      const message = fields.length
        ? `${fields.join(', ')} already exists`
        : 'Duplicate value';
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'DUPLICATE_KEY',
        message,
        errors: fields.map((field) => ({
          field,
          messages: ['already exists'],
        })),
      };
    }

    // Unknown error: full details go to the server log only, never to the client.
    this.logger.error(
      `Unhandled error on ${route}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }

  private fromHttpException(exception: HttpException): ErrorBody {
    const statusCode = exception.getStatus();
    const res = exception.getResponse();
    const fields =
      typeof res === 'object' && res !== null
        ? (res as { code?: unknown; message?: unknown; errors?: unknown })
        : { message: res };

    let message = Array.isArray(fields.message)
      ? fields.message.join('; ')
      : typeof fields.message === 'string'
        ? fields.message
        : (STATUS_CODES[statusCode] ?? 'Error');

    // Never echo the requested URL (or its query string) back to the client.
    if (
      exception instanceof NotFoundException &&
      ROUTER_NOT_FOUND.test(message)
    ) {
      message = 'Route not found';
    }

    return {
      statusCode,
      code:
        typeof fields.code === 'string'
          ? fields.code
          : (CODE_BY_STATUS[statusCode] ?? `HTTP_${statusCode}`),
      message,
      ...(Array.isArray(fields.errors) && {
        errors: fields.errors as FieldErrorDto[],
      }),
    };
  }
}
