import {
  Body,
  ConflictException,
  Controller,
  Get,
  INestApplication,
  Logger,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from './../src/app.setup';

// Test-only DTOs and controller: they live here, not under src/, so they never
// appear in the real API or in Swagger. No AppModule, no MongoDB.
class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  name: string;
}

class PassengerDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  age: number;
}

class BookingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  passengers: PassengerDto[];
}

@Controller('test')
class ErrorTestController {
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return dto;
  }

  @Post('bookings')
  book(@Body() dto: BookingDto) {
    return dto;
  }

  @Get('conflict')
  conflict() {
    throw new ConflictException({
      code: 'SEAT_UNAVAILABLE',
      message: 'Only 1 seat left',
    });
  }

  @Get('flight')
  flight() {
    throw new NotFoundException('Flight not found');
  }

  @Get('duplicate')
  duplicate() {
    throw Object.assign(new Error('E11000 duplicate key error'), {
      code: 11000,
      keyValue: { email: 'x' },
    });
  }

  @Get('cast')
  cast() {
    throw Object.assign(new Error('Cast to ObjectId failed for value "abc"'), {
      name: 'CastError',
      path: '_id',
      value: 'abc',
    });
  }

  @Get('unavailable')
  unavailable() {
    throw new ServiceUnavailableException('Payment provider unavailable');
  }

  @Get('crash')
  crash() {
    throw new Error('secret internal detail');
  }
}

describe('API error format (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ErrorTestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const timestamp = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);

  it('returns 400 VALIDATION_FAILED with one entry per invalid field', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/test/register')
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      error: 'Bad Request',
      message: 'Validation failed',
      errors: [
        { field: 'email', messages: ['email must be an email'] },
        { field: 'name', messages: ['name must be a string'] },
      ],
      path: '/api/test/register',
      timestamp,
    });
  });

  it('uses dotted paths for invalid array elements', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/test/bookings')
      .send({
        passengers: [
          { name: 'Ana', age: 30 },
          { name: 42, age: 5 },
        ],
      })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([
      { field: 'passengers.1.name', messages: ['name must be a string'] },
    ]);
  });

  it('rejects unknown fields, including nested ones', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/test/bookings')
      .send({
        passengers: [{ name: 'Ana', age: 30, vip: true }],
        role: 'admin',
      })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { field: 'role', messages: ['property role should not exist'] },
        {
          field: 'passengers.0.vip',
          messages: ['property vip should not exist'],
        },
      ]),
    );
  });

  it('returns 404 "Route not found" for an unknown route without echoing the URL', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/nope?token=abc')
      .expect(404);

    expect(res.body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      error: 'Not Found',
      message: 'Route not found',
      path: '/api/nope',
      timestamp,
    });
    expect(JSON.stringify(res.body)).not.toContain('token');
  });

  it('keeps the message of a custom NotFoundException', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/test/flight')
      .expect(404);

    expect(res.body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      error: 'Not Found',
      message: 'Flight not found',
      path: '/api/test/flight',
      timestamp,
    });
  });

  it('keeps a custom code and message from an HttpException', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/test/conflict')
      .expect(409);

    expect(res.body).toEqual({
      statusCode: 409,
      code: 'SEAT_UNAVAILABLE',
      error: 'Conflict',
      message: 'Only 1 seat left',
      path: '/api/test/conflict',
      timestamp,
    });
  });

  it('maps a MongoDB duplicate key error to 409 DUPLICATE_KEY', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/test/duplicate')
      .expect(409);

    expect(res.body).toEqual({
      statusCode: 409,
      code: 'DUPLICATE_KEY',
      error: 'Conflict',
      message: 'email already exists',
      errors: [{ field: 'email', messages: ['already exists'] }],
      path: '/api/test/duplicate',
      timestamp,
    });
  });

  it('hides internal errors from the client and logs them on the server', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const res = await request(app.getHttpServer())
      .get('/api/test/crash')
      .expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      error: 'Internal Server Error',
      message: 'Internal server error',
      path: '/api/test/crash',
      timestamp,
    });
    // toEqual above already rules out extra keys such as "stack".
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    expect(logSpy).toHaveBeenCalledWith(
      'Unhandled error on GET /api/test/crash',
      expect.stringContaining('secret internal detail'),
    );
  });

  it('maps a Mongoose CastError to 400 INVALID_VALUE without echoing the value', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const res = await request(app.getHttpServer())
      .get('/api/test/cast')
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      code: 'INVALID_VALUE',
      error: 'Bad Request',
      message: 'Invalid value for "_id"',
      errors: [{ field: '_id', messages: ['invalid value'] }],
      path: '/api/test/cast',
      timestamp,
    });
    expect(JSON.stringify(res.body)).not.toContain('abc');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns a 5xx HttpException as-is and logs it on the server', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const res = await request(app.getHttpServer())
      .get('/api/test/unavailable')
      .expect(503);

    expect(res.body).toEqual({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      error: 'Service Unavailable',
      message: 'Payment provider unavailable',
      path: '/api/test/unavailable',
      timestamp,
    });
    expect(logSpy).toHaveBeenCalledWith(
      'HttpException 503 on GET /api/test/unavailable',
      expect.stringContaining('ServiceUnavailableException'),
    );
  });
});
