import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from './../src/common/auth/auth.enums';
import type { AuthenticatedUser } from './../src/common/auth/authenticated-user';
import { FlightDto } from './../src/flights/flights/dto/flight.dto';
import { FlightsController } from './../src/flights/flights/flights.controller';
import { FlightsService } from './../src/flights/flights/flights.service';
import { configureApp } from './../src/app.setup';

// Routing, validation and error shape of the real controller with a fake service: no
// MongoDB, so it runs anywhere. The global guards are not loaded here (they have their own
// tests), so a test middleware sets request.user the way JwtAuthGuard does: the header
// x-test-user holds a user id, and without it the request is anonymous.
// The service rules have their own unit tests.
const MODERATOR_ID = '6720f1c2a1b2c3d4e5f60001';
const SESSION_ID = '6720f1c2a1b2c3d4e5f60002';
const FLIGHT: FlightDto = {
  id: '6720f1c2a1b2c3d4e5f60718',
  airlineId: '6af1561d0ee83eb5be8d1f25',
  flightNumber: 'MS777',
  departureAirportId: 'CAI',
  arrivalAirportId: 'DXB',
  departureLocalInput: '2026-12-20T08:30',
  arrivalLocalInput: '2026-12-20T14:30',
  departureAtUtc: '2026-12-20T06:30:00.000Z',
  arrivalAtUtc: '2026-12-20T10:30:00.000Z',
  departureDateKey: '2026-12-20',
  durationMinutes: 240,
  status: 'SCHEDULED' as FlightDto['status'],
  cabinInventory: [],
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
};
const BODY = {
  flightNumber: 'ms777',
  departureAirportId: 'cai',
  arrivalAirportId: 'dxb',
  departureLocalInput: '2026-12-20T08:30',
  arrivalLocalInput: '2026-12-20T14:30',
};

describe('Flights (e2e, fake service)', () => {
  let app: INestApplication<App>;
  const service = {
    create: jest.fn(
      (_dto: unknown, _user: AuthenticatedUser): Promise<FlightDto> =>
        Promise.resolve(FLIGHT),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FlightsController],
      providers: [{ provide: FlightsService, useValue: service }],
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

  const post = (body: object = BODY) =>
    request(app.getHttpServer())
      .post('/api/flights')
      .set('x-test-user', MODERATOR_ID)
      .send(body);

  it('POST /api/flights creates with 201, normalised input and the logged-in user', async () => {
    const res = await post().expect(201);
    expect(res.body).toMatchObject({
      id: FLIGHT.id,
      status: 'SCHEDULED',
      durationMinutes: 240,
      cabinInventory: [],
    });
    expect(service.create.mock.calls[0][0]).toMatchObject({
      flightNumber: 'MS777',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2026-12-20T08:30',
      arrivalLocalInput: '2026-12-20T14:30',
    });
    expect(service.create.mock.calls[0][1]).toEqual({
      userId: MODERATOR_ID,
      role: 'AIRLINE_MODERATOR',
      sessionId: SESSION_ID,
    });
  });

  it('POST returns 401 UNAUTHENTICATED without a logged-in user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/flights')
      .send(BODY)
      .expect(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('POST returns field-level errors for a bad body (GEN-02)', async () => {
    const res = await post({
      flightNumber: 'M',
      departureAirportId: 'CA',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2026-12-20 08:30',
    }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const fields = (res.body.errors as { field: string }[]).map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'flightNumber',
        'departureAirportId',
        'departureLocalInput',
        'arrivalLocalInput',
      ]),
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([
    'airlineId',
    'status',
    'cabinInventory',
    'departureAtUtc',
    'arrivalAtUtc',
    'departureDateKey',
  ])('POST rejects the client-supplied field %s', async (field) => {
    const res = await post({ ...BODY, [field]: 'x' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('POST returns the shared 409 error shape', async () => {
    service.create.mockRejectedValueOnce(
      new ConflictException({
        code: 'FLIGHT_ALREADY_EXISTS',
        message:
          'This airline already has a flight with this number on this departure date',
        errors: [
          {
            field: 'flightNumber',
            messages: ['already used on this departure date'],
          },
        ],
      }),
    );
    const res = await post().expect(409);
    expect(res.body).toMatchObject({
      statusCode: 409,
      code: 'FLIGHT_ALREADY_EXISTS',
      path: '/api/flights',
    });
  });
});
