import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from './../src/common/auth/auth.enums';
import type { AuthenticatedUser } from './../src/common/auth/authenticated-user';
import { configureApp } from './../src/app.setup';
import { AirlineBookingsController } from './../src/flights/airline-bookings/airline-bookings.controller';
import { AirlineBookingsService } from './../src/flights/airline-bookings/airline-bookings.service';
import type { ListFlightBookingsQueryDto } from './../src/flights/airline-bookings/dto/airline-flight-bookings.dto';

// FLT-29 routing, validation and headers of the real controller with a fake service (no
// MongoDB). The x-test-user header stands in for the login guard; the roles guard is not
// loaded here, so the role rule has its own tests.
const MODERATOR_ID = '6720f1c2a1b2c3d4e5f60001';
const SESSION_ID = '6720f1c2a1b2c3d4e5f60002';
const FLIGHT_ID = '6720f1c2a1b2c3d4e5f60718';

const LIST = {
  flight: {
    id: FLIGHT_ID,
    flightNumber: 'MS777',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAtUtc: '2026-12-20T06:30:00.000Z',
    arrivalAtUtc: '2026-12-20T10:30:00.000Z',
    status: 'SCHEDULED',
  },
  seats: [
    {
      category: 'ECONOMY',
      totalSeats: 150,
      bookedSeats: 40,
      heldSeats: 2,
      remainingSeats: 108,
    },
  ],
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
};

describe('Airline flight bookings (e2e, fake service)', () => {
  let app: INestApplication<App>;
  const service = {
    list: jest.fn(
      (
        _id: string,
        _query: ListFlightBookingsQueryDto,
        _user: AuthenticatedUser,
      ) => Promise.resolve(LIST),
    ),
    exportPassengers: jest.fn((_id: string, _user: AuthenticatedUser) =>
      Promise.resolve({
        filename: 'passengers-MS777-2026-12-20.csv',
        csv: '﻿Booking reference\r\nK7M2QX\r\n',
      }),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AirlineBookingsController],
      providers: [{ provide: AirlineBookingsService, useValue: service }],
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

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('x-test-user', MODERATOR_ID);

  it('GET /api/flights/:id/bookings returns the flight, the seats and one page', async () => {
    const res = await get(`/api/flights/${FLIGHT_ID}/bookings`).expect(200);

    expect(res.body).toMatchObject({
      flight: { flightNumber: 'MS777' },
      seats: [{ category: 'ECONOMY', remainingSeats: 108 }],
      bookings: { items: [], meta: { page: 1, pageSize: 10 } },
    });
    expect(service.list.mock.calls[0][0]).toBe(FLIGHT_ID);
    expect(service.list.mock.calls[0][1]).toMatchObject({ page: 1 });
    expect(service.list.mock.calls[0][2]).toEqual({
      userId: MODERATOR_ID,
      role: 'AIRLINE_MODERATOR',
      sessionId: SESSION_ID,
    });
  });

  it('passes the page and the status filter through', async () => {
    await get(
      `/api/flights/${FLIGHT_ID}/bookings?page=2&status=CANCELLED`,
    ).expect(200);

    expect(service.list.mock.calls[0][1]).toMatchObject({
      page: 2,
      status: 'CANCELLED',
    });
  });

  it.each(['PENDING_PAYMENT', 'EXPIRED', 'nonsense'])(
    'rejects the status filter %s with a field error',
    async (status) => {
      const res = await get(
        `/api/flights/${FLIGHT_ID}/bookings?status=${status}`,
      ).expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe('status');
      expect(service.list).not.toHaveBeenCalled();
    },
  );

  it('rejects page 0 with a field error', async () => {
    const res = await get(`/api/flights/${FLIGHT_ID}/bookings?page=0`).expect(
      400,
    );

    expect(res.body.errors[0].field).toBe('page');
  });

  it('GET bookings returns 401 UNAUTHENTICATED without a logged-in user', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/flights/${FLIGHT_ID}/bookings`)
      .expect(401);

    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(service.list).not.toHaveBeenCalled();
  });

  it('GET /api/flights/:id/passengers/export returns a CSV attachment', async () => {
    const res = await get(`/api/flights/${FLIGHT_ID}/passengers/export`).expect(
      200,
    );

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="passengers-MS777-2026-12-20.csv"',
    );
    expect(res.text).toContain('K7M2QX');
    expect(service.exportPassengers.mock.calls[0][0]).toBe(FLIGHT_ID);
  });

  it('GET export returns 401 UNAUTHENTICATED without a logged-in user', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/flights/${FLIGHT_ID}/passengers/export`)
      .expect(401);

    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(service.exportPassengers).not.toHaveBeenCalled();
  });
});
