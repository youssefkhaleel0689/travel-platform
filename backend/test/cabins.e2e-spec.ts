import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from './../src/common/auth/auth.enums';
import type { AuthenticatedUser } from './../src/common/auth/authenticated-user';
import { CabinsController } from './../src/flights/cabins/cabins.controller';
import { CabinsService } from './../src/flights/cabins/cabins.service';
import { FlightDto } from './../src/flights/flights/dto/flight.dto';
import { configureApp } from './../src/app.setup';

// Routing, validation and error shape of the real cabins controller with a fake service
// (no MongoDB). As in flights.e2e-spec.ts, a middleware sets request.user from the header
// x-test-user because the global guards are not loaded here. The rules (own airline,
// SCHEDULED, one cabin per category) have unit tests in cabins.service.spec.ts.
const MODERATOR_ID = '6720f1c2a1b2c3d4e5f60001';
const SESSION_ID = '6720f1c2a1b2c3d4e5f60002';
const FLIGHT_ID = '6720f1c2a1b2c3d4e5f60718';
const FLIGHT: FlightDto = {
  id: FLIGHT_ID,
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
  cabinInventory: [
    {
      category: 'ECONOMY' as FlightDto['cabinInventory'][number]['category'],
      totalSeats: 150,
      bookedSeats: 0,
      heldSeats: 0,
      price: '199.99',
      freeBaggageCount: 1,
      maxBagWeightKg: 23,
    },
  ],
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T10:00:00.000Z',
};
const BODY = {
  category: 'economy',
  totalSeats: 150,
  price: 199.99,
  freeBaggageCount: 1,
  maxBagWeightKg: 23,
};

describe('Cabins (e2e, fake service)', () => {
  let app: INestApplication<App>;
  const service = {
    add: jest.fn(
      (
        _id: string,
        _dto: unknown,
        _user: AuthenticatedUser,
      ): Promise<FlightDto> => Promise.resolve(FLIGHT),
    ),
    update: jest.fn(
      (
        _id: string,
        _cabinId: string,
        _dto: unknown,
        _user: AuthenticatedUser,
      ): Promise<FlightDto> => Promise.resolve(FLIGHT),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CabinsController],
      providers: [{ provide: CabinsService, useValue: service }],
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
      .post(`/api/flights/${FLIGHT_ID}/cabins`)
      .set('x-test-user', MODERATOR_ID)
      .send(body);

  const patch = (cabin: string, body: object) =>
    request(app.getHttpServer())
      .patch(`/api/flights/${FLIGHT_ID}/cabins/${cabin}`)
      .set('x-test-user', MODERATOR_ID)
      .send(body);

  it('POST creates with 201, a normalised category, the flight id and the logged-in user', async () => {
    const res = await post().expect(201);
    expect(res.body).toMatchObject({
      id: FLIGHT_ID,
      cabinInventory: [{ category: 'ECONOMY', price: '199.99' }],
    });
    expect(service.add.mock.calls[0][0]).toBe(FLIGHT_ID);
    expect(service.add.mock.calls[0][1]).toMatchObject({
      category: 'ECONOMY',
      totalSeats: 150,
      price: 199.99,
    });
    expect(service.add.mock.calls[0][2]).toEqual({
      userId: MODERATOR_ID,
      role: 'AIRLINE_MODERATOR',
      sessionId: SESSION_ID,
    });
  });

  it('POST returns 401 UNAUTHENTICATED without a logged-in user', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/flights/${FLIGHT_ID}/cabins`)
      .send(BODY)
      .expect(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(service.add).not.toHaveBeenCalled();
  });

  it('POST returns field-level 400 errors for invalid values', async () => {
    const res = await post({
      ...BODY,
      category: 'LUXURY',
      totalSeats: 0,
      price: 0,
      freeBaggageCount: -1,
      maxBagWeightKg: 0,
    }).expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
    });
    const fields = (res.body as { errors: { field: string }[] }).errors.map(
      (error) => error.field,
    );
    expect(fields.sort()).toEqual([
      'category',
      'freeBaggageCount',
      'maxBagWeightKg',
      'price',
      'totalSeats',
    ]);
    expect(service.add).not.toHaveBeenCalled();
  });

  it('POST rejects the counters and the status, which only the server sets', async () => {
    for (const field of ['bookedSeats', 'heldSeats', 'status', 'airlineId']) {
      await post({ ...BODY, [field]: 5 }).expect(400);
    }
    expect(service.add).not.toHaveBeenCalled();
  });

  it('PATCH changes price and baggage with 200, taking the category from the path', async () => {
    const res = await patch('ECONOMY', {
      price: 179.5,
      freeBaggageCount: 2,
    }).expect(200);
    expect(res.body).toMatchObject({ id: FLIGHT_ID });
    expect(service.update.mock.calls[0][0]).toBe(FLIGHT_ID);
    expect(service.update.mock.calls[0][1]).toBe('ECONOMY');
    expect(service.update.mock.calls[0][2]).toEqual({
      price: 179.5,
      freeBaggageCount: 2,
    });
  });

  it('PATCH does not accept totalSeats (that is FLT-05) or the counters', async () => {
    for (const field of [
      'totalSeats',
      'bookedSeats',
      'heldSeats',
      'category',
    ]) {
      await patch('ECONOMY', { [field]: 5 }).expect(400);
    }
    expect(service.update).not.toHaveBeenCalled();
  });

  it('PATCH returns field-level 400 errors and rejects null', async () => {
    const res = await patch('ECONOMY', {
      price: 0,
      maxBagWeightKg: null,
    }).expect(400);
    const fields = (res.body as { errors: { field: string }[] }).errors.map(
      (error) => error.field,
    );
    expect(fields.sort()).toEqual(['maxBagWeightKg', 'price']);
  });

  it('PATCH returns 401 without a logged-in user', async () => {
    await request(app.getHttpServer())
      .patch(`/api/flights/${FLIGHT_ID}/cabins/ECONOMY`)
      .send({ price: 1 })
      .expect(401);
  });

  it('returns the shared 404 error shape from the service', async () => {
    service.update.mockRejectedValueOnce(
      new NotFoundException({
        code: 'CABIN_NOT_FOUND',
        message: 'This flight has no FIRST cabin',
      }),
    );
    const res = await patch('FIRST', { price: 100 }).expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'CABIN_NOT_FOUND',
      path: `/api/flights/${FLIGHT_ID}/cabins/FIRST`,
    });
  });
});
