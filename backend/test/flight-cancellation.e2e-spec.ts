import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from './../src/common/auth/auth.enums';
import type { AuthenticatedUser } from './../src/common/auth/authenticated-user';
import { configureApp } from './../src/app.setup';
import type {
  CancelFlightDto,
  CancelledFlightResultDto,
} from './../src/flights/flight-cancellation/dto/cancel-flight.dto';
import { FlightCancellationController } from './../src/flights/flight-cancellation/flight-cancellation.controller';
import { FlightCancellationService } from './../src/flights/flight-cancellation/flight-cancellation.service';

// FLT-06 routing, validation and error shape of the real controller with a fake service (no
// MongoDB). The x-test-user header stands in for the login guard; the roles guard is not
// loaded here, so the role rule has its own tests.
const MODERATOR_ID = '6720f1c2a1b2c3d4e5f60001';
const SESSION_ID = '6720f1c2a1b2c3d4e5f60002';
const FLIGHT_ID = '6720f1c2a1b2c3d4e5f60718';

const RESULT = {
  flight: { id: FLIGHT_ID, flightNumber: 'MS777', status: 'CANCELLED' },
  cancelledBookings: 42,
  releasedHolds: 3,
  refundsRequested: 42,
  refundsFailed: 0,
} as unknown as CancelledFlightResultDto;

describe('Flight cancellation (e2e, fake service)', () => {
  let app: INestApplication<App>;
  const service = {
    cancel: jest.fn(
      (
        _id: string,
        _dto: CancelFlightDto,
        _user: AuthenticatedUser,
      ): Promise<CancelledFlightResultDto> => Promise.resolve(RESULT),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FlightCancellationController],
      providers: [{ provide: FlightCancellationService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.headers['x-test-user'];
      if (typeof userId === 'string') {
        req.user = {
          userId,
          role: Role.AIRLINE_MODERATOR,
          sessionId: SESSION_ID,
        };
      }
      next();
    });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const asModerator = (r: request.Test) => r.set('x-test-user', MODERATOR_ID);
  const url = `/api/flights/${FLIGHT_ID}/cancel`;

  it('POST /api/flights/:id/cancel answers 200 with the counts and passes the actor on', async () => {
    const res = await asModerator(
      request(app.getHttpServer())
        .post(url)
        .send({ confirm: true, reason: '  Aircraft unavailable  ' }),
    ).expect(200);

    expect(res.body).toMatchObject({
      cancelledBookings: 42,
      releasedHolds: 3,
      refundsRequested: 42,
      refundsFailed: 0,
    });
    expect(service.cancel).toHaveBeenCalledTimes(1);
    expect(service.cancel.mock.calls[0][0]).toBe(FLIGHT_ID);
    // The reason is trimmed by the DTO.
    expect(service.cancel.mock.calls[0][1]).toEqual({
      confirm: true,
      reason: 'Aircraft unavailable',
    });
    expect(service.cancel.mock.calls[0][2]).toEqual({
      userId: MODERATOR_ID,
      role: 'AIRLINE_MODERATOR',
      sessionId: SESSION_ID,
    });
  });

  it('accepts the confirmation without a reason', async () => {
    await asModerator(
      request(app.getHttpServer()).post(url).send({ confirm: true }),
    ).expect(200);

    expect(service.cancel.mock.calls[0][1]).toEqual({ confirm: true });
  });

  it('rejects a missing confirmation with a field error', async () => {
    const res = await asModerator(
      request(app.getHttpServer()).post(url).send({}),
    ).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].field).toBe('confirm');
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it('rejects confirm: false', async () => {
    const res = await asModerator(
      request(app.getHttpServer()).post(url).send({ confirm: false }),
    ).expect(400);

    expect(res.body.errors[0]).toMatchObject({
      field: 'confirm',
      messages: ['confirm must be true to cancel the flight'],
    });
  });

  it('rejects a reason that is too long and a field the endpoint does not know', async () => {
    const res = await asModerator(
      request(app.getHttpServer())
        .post(url)
        .send({ confirm: true, reason: 'x'.repeat(501), status: 'SCHEDULED' }),
    ).expect(400);

    const fields = (res.body.errors as { field: string }[]).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['reason', 'status']));
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it('shows a service refusal in the standard error shape', async () => {
    service.cancel.mockRejectedValueOnce(
      new ConflictException({
        code: 'FLIGHT_ALREADY_CANCELLED',
        message: 'This flight is already cancelled',
      }),
    );

    const res = await asModerator(
      request(app.getHttpServer()).post(url).send({ confirm: true }),
    ).expect(409);

    expect(res.body).toMatchObject({
      code: 'FLIGHT_ALREADY_CANCELLED',
      message: 'This flight is already cancelled',
    });
  });
});
