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
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  423: 'LOCKED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

// Nest's router 404 text, e.g. "Cannot GET /api/nope?token=abc".
const ROUTER_NOT_FOUND = /^Cannot [A-Z]+ \//;

// What toErrorBody() decides; path, timestamp and error are added in catch().
// retryAfterSeconds becomes the Retry-After header and is never part of the body.
type ErrorBody = Omit<ErrorResponseDto, 'path' | 'timestamp' | 'error'> & {
  retryAfterSeconds?: number;
};

// The fields read from an HttpException's response object. Anything else on it is dropped.
interface HttpExceptionFields {
  code?: unknown;
  message?: unknown;
  errors?: unknown;
  details?: unknown;
  retryAfterSeconds?: unknown;
}

// A plain object literal: not null, not an array, not a Date or another class instance.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

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

// Mongoose ValidationError: a schema rule (required, min, enum, a custom
// validator) refused a document the DTO let through. Field names only.
function isMongooseValidationError(
  e: unknown,
): e is { name: 'ValidationError'; errors: Record<string, unknown> } {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'ValidationError' &&
    typeof (e as { errors?: unknown }).errors === 'object' &&
    (e as { errors?: unknown }).errors !== null
  );
}

// Mongoose VersionError: two requests saved the same document at once and
// this one lost (array edits on itineraries, bookings). Not a server fault.
function isVersionError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'VersionError'
  );
}

// BSONError from new Types.ObjectId(<not 24 hex>): a malformed id that slipped
// past a DTO. Treated like a CastError rather than a server fault.
function isBsonError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'BSONError'
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
      ...(body.details && { details: body.details }),
      path,
      timestamp: new Date().toISOString(),
    };
    if (body.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(body.retryAfterSeconds));
    }
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

    if (isBsonError(exception)) {
      this.logger.warn(`Malformed id on ${route}`);
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_ID',
        message: 'An id in the request is not a valid id',
      };
    }

    if (isMongooseValidationError(exception)) {
      // Messages are generic: a schema message can quote the rejected value.
      const fields = Object.keys(exception.errors);
      this.logger.warn(
        `Schema validation failed on ${route}: ${fields.join(', ')}`,
      );
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: fields.length
          ? `Invalid value for ${fields.map((f) => `"${f}"`).join(', ')}`
          : 'Validation failed',
        errors: fields.map((field) => ({ field, messages: ['invalid value'] })),
      };
    }

    if (isVersionError(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'CONCURRENT_UPDATE',
        message:
          'The resource was changed by another request at the same time; reload it and try again',
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
    const fields: HttpExceptionFields =
      typeof res === 'object' && res !== null ? res : { message: res };

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
      // Structured extras (e.g. lockedUntil for ACCOUNT_LOCKED), for client errors only:
      // a 5xx never carries details, so nothing internal can leak through them.
      ...(statusCode < 500 &&
        isPlainObject(fields.details) && { details: fields.details }),
      // Sent as the Retry-After header by catch(), never in the body.
      ...(isPositiveInteger(fields.retryAfterSeconds) && {
        retryAfterSeconds: fields.retryAfterSeconds,
      }),
    };
  }
}
