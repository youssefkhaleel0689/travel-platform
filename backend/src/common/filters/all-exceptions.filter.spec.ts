import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { AllExceptionsFilter } from './all-exceptions.filter';

const LOCKED_UNTIL = '2026-11-13T10:15:00.000Z';

// A fake Express response: status() returns the response, like Express does.
interface FakeResponse {
  status: jest.Mock<FakeResponse, [number]>;
  json: jest.Mock<FakeResponse, [unknown]>;
  setHeader: jest.Mock<FakeResponse, [string, string]>;
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    status: jest.fn((_code: number) => res),
    json: jest.fn((_body: unknown) => res),
    setHeader: jest.fn((_name: string, _value: string) => res),
  };
  return res;
}

// Runs the filter on one exception and returns what it sent.
function run(exception: unknown, originalUrl = '/api/auth/login') {
  const response = fakeResponse();
  const request = { method: 'POST', originalUrl };
  // The real Nest host over [request, response], so no cast is needed.
  new AllExceptionsFilter().catch(
    exception,
    new ExecutionContextHost([request, response]),
  );
  expect(response.status).toHaveBeenCalledTimes(1);
  expect(response.json).toHaveBeenCalledTimes(1);
  return {
    status: response.status.mock.calls[0][0],
    body: response.json.mock.calls[0][0] as Record<string, unknown>,
    setHeader: response.setHeader,
  };
}

function locked(extra: Record<string, unknown>): HttpException {
  return new HttpException(
    { code: 'ACCOUNT_LOCKED', message: 'account locked', ...extra },
    423,
  );
}

describe('AllExceptionsFilter', () => {
  // The filter logs 5xx and unknown errors; keep the test output clean.
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('details', () => {
    it('passes a details object through for a 4xx HttpException', () => {
      const { status, body } = run(
        locked({ details: { lockedUntil: LOCKED_UNTIL } }),
      );
      expect(status).toBe(423);
      expect(body).toEqual({
        statusCode: 423,
        code: 'ACCOUNT_LOCKED',
        error: 'Locked',
        message: 'account locked',
        details: { lockedUntil: LOCKED_UNTIL },
        path: '/api/auth/login',
        timestamp: expect.any(String),
      });
    });

    it('puts the fields in the documented order', () => {
      const { body } = run(
        new HttpException(
          {
            code: 'X',
            message: 'x',
            errors: [{ field: 'email', messages: ['bad'] }],
            details: { a: 1 },
          },
          400,
        ),
      );
      expect(Object.keys(body)).toEqual([
        'statusCode',
        'code',
        'error',
        'message',
        'errors',
        'details',
        'path',
        'timestamp',
      ]);
    });

    it('is absent when not provided', () => {
      expect(run(locked({})).body).not.toHaveProperty('details');
    });

    it.each([
      ['a string', 'locked'],
      ['an array', [LOCKED_UNTIL]],
      ['null', null],
      ['a Date', new Date(LOCKED_UNTIL)],
    ])('is ignored when it is %s', (_label, details) => {
      expect(run(locked({ details })).body).not.toHaveProperty('details');
    });

    it('is dropped for a 5xx HttpException', () => {
      const { status, body } = run(
        new InternalServerErrorException({
          code: 'BOOM',
          message: 'boom',
          details: { internal: 'stack' },
        }),
      );
      expect(status).toBe(500);
      expect(body).not.toHaveProperty('details');
    });
  });

  describe('Retry-After', () => {
    it('sets the header from retryAfterSeconds and keeps it out of the body', () => {
      const { body, setHeader } = run(
        locked({
          details: { lockedUntil: LOCKED_UNTIL },
          retryAfterSeconds: 840,
        }),
      );
      expect(setHeader).toHaveBeenCalledTimes(1);
      expect(setHeader).toHaveBeenCalledWith('Retry-After', '840');
      expect(body).not.toHaveProperty('retryAfterSeconds');
      expect(JSON.stringify(body)).not.toContain('840');
    });

    it.each([0, -5, 1.5, '840', Number.NaN, null])(
      'sets no header for retryAfterSeconds %p',
      (retryAfterSeconds) => {
        const { body, setHeader } = run(locked({ retryAfterSeconds }));
        expect(setHeader).not.toHaveBeenCalled();
        expect(body).not.toHaveProperty('retryAfterSeconds');
      },
    );

    it('sets no header when retryAfterSeconds is missing', () => {
      expect(run(locked({})).setHeader).not.toHaveBeenCalled();
    });
  });

  describe('allow-list', () => {
    it('drops unknown top-level fields', () => {
      const { body } = run(
        locked({ secret: 's3cr3t', lockedUntil: LOCKED_UNTIL }),
      );
      expect(body).not.toHaveProperty('secret');
      expect(body).not.toHaveProperty('lockedUntil');
      expect(JSON.stringify(body)).not.toContain('s3cr3t');
    });
  });

  describe('existing behaviour', () => {
    it('keeps a validation-style errors array', () => {
      const errors = [{ field: 'email', messages: ['email must be an email'] }];
      const { status, body } = run(
        new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          errors,
        }),
      );
      expect(status).toBe(400);
      expect(body).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        error: 'Bad Request',
        errors,
      });
      expect(body).not.toHaveProperty('details');
    });

    it('hides the router 404 text and the query string', () => {
      const { status, body } = run(
        new NotFoundException('Cannot GET /x?token=abc'),
        '/x?token=abc',
      );
      expect(status).toBe(404);
      expect(body).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Route not found',
        path: '/x',
      });
      expect(JSON.stringify(body)).not.toContain('token');
    });

    it('turns a CastError into 400 INVALID_VALUE without the value', () => {
      const castError = Object.assign(new Error('Cast to ObjectId failed'), {
        name: 'CastError',
        path: 'id',
        value: 'secret-input',
      });
      const { status, body, setHeader } = run(castError);
      expect(status).toBe(400);
      expect(body).toMatchObject({
        statusCode: 400,
        code: 'INVALID_VALUE',
        message: 'Invalid value for "id"',
        errors: [{ field: 'id', messages: ['invalid value'] }],
      });
      expect(JSON.stringify(body)).not.toContain('secret-input');
      expect(body).not.toHaveProperty('details');
      expect(setHeader).not.toHaveBeenCalled();
    });

    it('turns a duplicate key into 409 DUPLICATE_KEY with field names only', () => {
      const duplicate = Object.assign(new Error('E11000'), {
        code: 11000,
        keyValue: { email: 'sara@example.com' },
        details: { leaked: true },
        retryAfterSeconds: 60,
      });
      const { status, body, setHeader } = run(duplicate);
      expect(status).toBe(409);
      expect(body).toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_KEY',
        error: 'Conflict',
        message: 'email already exists',
        errors: [{ field: 'email', messages: ['already exists'] }],
      });
      expect(JSON.stringify(body)).not.toContain('sara@example.com');
      expect(body).not.toHaveProperty('details');
      expect(setHeader).not.toHaveBeenCalled();
    });

    it('turns a Mongoose ValidationError into 400 VALIDATION_FAILED with field names only', () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const invalid = Object.assign(new Error('total: 0 is not > 0'), {
        name: 'ValidationError',
        errors: { 'priceSnapshot.total': { message: 'secret-0.00 rejected' } },
      });
      const { status, body } = run(invalid);
      expect(status).toBe(400);
      expect(body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'priceSnapshot.total', messages: ['invalid value'] }],
      });
      expect(JSON.stringify(body)).not.toContain('secret-0.00');
    });

    it('turns a Mongoose VersionError into 409 CONCURRENT_UPDATE', () => {
      const lost = Object.assign(new Error('No matching document'), {
        name: 'VersionError',
      });
      const { status, body } = run(lost);
      expect(status).toBe(409);
      expect(body).toMatchObject({ code: 'CONCURRENT_UPDATE' });
    });

    it('turns a BSONError (malformed id) into 400 INVALID_ID, not 500', () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const bson = Object.assign(new Error('input must be a 24 character hex string'), {
        name: 'BSONError',
      });
      const { status, body } = run(bson);
      expect(status).toBe(400);
      expect(body).toMatchObject({ code: 'INVALID_ID' });
    });

    it('names a 413 PAYLOAD_TOO_LARGE', () => {
      expect(run(new HttpException('request entity too large', 413)).body.code).toBe(
        'PAYLOAD_TOO_LARGE',
      );
    });

    it('turns an unknown error into 500 INTERNAL_ERROR without details', () => {
      const unknown = Object.assign(new Error('db password in here'), {
        details: { leaked: true },
        retryAfterSeconds: 60,
      });
      const { status, body, setHeader } = run(unknown);
      expect(status).toBe(500);
      expect(body).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        error: 'Internal Server Error',
        message: 'Internal server error',
        path: '/api/auth/login',
        timestamp: expect.any(String),
      });
      expect(setHeader).not.toHaveBeenCalled();
    });

    it('uses the Node status text as error (423 is "Locked")', () => {
      expect(run(locked({})).body.error).toBe('Locked');
    });

    it('still accepts a conflict raised by a service', () => {
      const { status, body } = run(
        new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'email is already registered',
        }),
      );
      expect(status).toBe(409);
      expect(body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });
  });
});
