import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from './../src/common/auth/auth.enums';
import type { AuthenticatedUser } from './../src/common/auth/authenticated-user';
import { configureApp } from './../src/app.setup';
import type {
  CancelFlightBookingDto,
  CancellationQuoteDto,
  CancelledFlightBookingDto,
  ListMyFlightBookingsQueryDto,
  MyFlightBookingsDto,
} from './../src/flights/my-bookings/dto/my-flight-bookings.dto';
import { MyFlightBookingsController } from './../src/flights/my-bookings/my-flight-bookings.controller';
import { MyFlightBookingsService } from './../src/flights/my-bookings/my-flight-bookings.service';

// FLT-25 and FLT-26 routing, validation and error shape of the real controller with a fake
// service (no MongoDB). The x-test-user header stands in for the login guard.
const USER_ID = '6720f1c2a1b2c3d4e5f60001';
const SESSION_ID = '6720f1c2a1b2c3d4e5f60002';
const BOOKING_ID = '6720f1c2a1b2c3d4e5f60720';

const LIST = {
  group: 'UPCOMING',
  counts: { upcoming: 1, past: 0, cancelled: 0 },
  bookings: {
    items: [],
    meta: {
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  },
} as unknown as MyFlightBookingsDto;

const QUOTE: CancellationQuoteDto = {
  bookingId: BOOKING_ID,
  bookingReference: 'K7M2QX',
  canCancel: true,
  blockedReason: null,
  departureAtUtc: '2026-12-20T06:30:00.000Z',
  daysRemaining: 10,
  refundPercentage: 50,
  refundAmount: '200.00',
  currency: 'USD',
  tiers: [{ daysBeforeDeparture: 7, refundPercentage: 50 }],
};

const CANCELLED = {
  id: BOOKING_ID,
  bookingReference: 'K7M2QX',
  status: 'CANCELLED',
  cancelledAt: '2026-11-19T08:00:00.000Z',
  refundPercentage: 50,
  refundAmount: '200.00',
  currency: 'USD',
  refundId: null,
} as CancelledFlightBookingDto;

describe('My flight bookings (e2e, fake service)', () => {
  let app: INestApplication<App>;
  const service = {
    list: jest.fn(
      (_query: ListMyFlightBookingsQueryDto, _user: AuthenticatedUser) =>
        Promise.resolve(LIST),
    ),
    cancellationQuote: jest.fn((_id: string, _user: AuthenticatedUser) =>
      Promise.resolve(QUOTE),
    ),
    cancel: jest.fn(
      (
        _id: string,
        _dto: CancelFlightBookingDto,
        _user: AuthenticatedUser,
      ): Promise<CancelledFlightBookingDto> => Promise.resolve(CANCELLED),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MyFlightBookingsController],
      providers: [{ provide: MyFlightBookingsService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.headers['x-test-user'];
      if (typeof userId === 'string') {
        req.user = { userId, role: Role.USER, sessionId: SESSION_ID };
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

  const asUser = (r: request.Test) => r.set('x-test-user', USER_ID);

  it('GET /api/flight-bookings defaults to the UPCOMING group, page 1', async () => {
    const res = await asUser(
      request(app.getHttpServer()).get('/api/flight-bookings'),
    ).expect(200);

    expect(res.body).toMatchObject({
      group: 'UPCOMING',
      counts: { upcoming: 1, past: 0, cancelled: 0 },
    });
    expect(service.list.mock.calls[0][0]).toMatchObject({
      page: 1,
      group: 'UPCOMING',
    });
    expect(service.list.mock.calls[0][1]).toEqual({
      userId: USER_ID,
      role: 'USER',
      sessionId: SESSION_ID,
    });
  });

  it('passes the group and the page through', async () => {
    await asUser(
      request(app.getHttpServer()).get(
        '/api/flight-bookings?group=CANCELLED&page=2',
      ),
    ).expect(200);

    expect(service.list.mock.calls[0][0]).toMatchObject({
      group: 'CANCELLED',
      page: 2,
    });
  });

  it('rejects an unknown group with a field error', async () => {
    const res = await asUser(
      request(app.getHttpServer()).get('/api/flight-bookings?group=SOON'),
    ).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].field).toBe('group');
    expect(service.list).not.toHaveBeenCalled();
  });

  it('GET /api/flight-bookings returns 401 UNAUTHENTICATED without a login', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/flight-bookings')
      .expect(401);

    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(service.list).not.toHaveBeenCalled();
  });

  it('GET .../cancellation-quote shows the refund', async () => {
    const res = await asUser(
      request(app.getHttpServer()).get(
        `/api/flight-bookings/${BOOKING_ID}/cancellation-quote`,
      ),
    ).expect(200);

    expect(res.body).toMatchObject({
      canCancel: true,
      refundPercentage: 50,
      refundAmount: '200.00',
    });
    expect(service.cancellationQuote.mock.calls[0][0]).toBe(BOOKING_ID);
  });

  it('POST .../cancel answers 200 with the refund and passes the reason', async () => {
    const res = await asUser(
      request(app.getHttpServer())
        .post(`/api/flight-bookings/${BOOKING_ID}/cancel`)
        .send({ reason: '  My plans changed ' }),
    ).expect(200);

    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      refundAmount: '200.00',
    });
    expect(service.cancel.mock.calls[0][0]).toBe(BOOKING_ID);
    expect(service.cancel.mock.calls[0][1]).toMatchObject({
      reason: 'My plans changed',
    });
  });

  it('POST .../cancel never accepts a client-supplied status or refund', async () => {
    const res = await asUser(
      request(app.getHttpServer())
        .post(`/api/flight-bookings/${BOOKING_ID}/cancel`)
        .send({ status: 'CANCELLED', refundPercentage: 100 }),
    ).expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(
      res.body.errors.map((e: { field: string }) => e.field).sort(),
    ).toEqual(['refundPercentage', 'status']);
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it('POST .../cancel rejects a reason over 500 characters', async () => {
    const res = await asUser(
      request(app.getHttpServer())
        .post(`/api/flight-bookings/${BOOKING_ID}/cancel`)
        .send({ reason: 'x'.repeat(501) }),
    ).expect(400);

    expect(res.body.errors[0].field).toBe('reason');
  });

  it('POST .../cancel keeps the error code of a 409', async () => {
    service.cancel.mockRejectedValueOnce(
      new ConflictException({
        code: 'DEPARTURE_PASSED',
        message: 'This booking can no longer be cancelled: its flight has left',
      }),
    );

    const res = await asUser(
      request(app.getHttpServer())
        .post(`/api/flight-bookings/${BOOKING_ID}/cancel`)
        .send({}),
    ).expect(409);

    expect(res.body.code).toBe('DEPARTURE_PASSED');
  });

  it('POST .../cancel returns 401 UNAUTHENTICATED without a login', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/flight-bookings/${BOOKING_ID}/cancel`)
      .send({})
      .expect(401);

    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(service.cancel).not.toHaveBeenCalled();
  });
});
