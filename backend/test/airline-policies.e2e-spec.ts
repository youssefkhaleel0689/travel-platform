import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from './../src/common/auth/auth.enums';
import type { AuthenticatedUser } from './../src/common/auth/authenticated-user';
import { AirlinePoliciesController } from './../src/flights/policies/airline-policies.controller';
import { AirlinePoliciesService } from './../src/flights/policies/airline-policies.service';
import { AirlinePolicyDto } from './../src/flights/policies/dto/airline-policy.dto';
import { configureApp } from './../src/app.setup';

// Routing, validation and error shape of the real policy controller with a fake service
// (no MongoDB). As in cabins.e2e-spec.ts, a middleware sets request.user from the header
// x-test-user because the global guards are not loaded here. The rules (assignment,
// deactivated airline, upsert) have unit tests in airline-policies.service.spec.ts.
const MODERATOR_ID = '6720f1c2a1b2c3d4e5f60001';
const SESSION_ID = '6720f1c2a1b2c3d4e5f60002';
const AIRLINE_ID = '6720f1c2a1b2c3d4e5f60718';
const POLICY: AirlinePolicyDto = {
  airlineId: AIRLINE_ID,
  extraBagPrice: '25.00',
  maxExtraBagsPerPassenger: 2,
  cancellationTiers: [
    { daysBeforeDeparture: 14, refundPercentage: 100 },
    { daysBeforeDeparture: 7, refundPercentage: 50 },
  ],
  version: 3,
  updatedAt: '2026-11-17T10:00:00.000Z',
};

describe('Airline policies (e2e, fake service)', () => {
  let app: INestApplication<App>;
  const service = {
    setBaggagePolicy: jest.fn(
      (_id: string, _dto: unknown, _user: AuthenticatedUser) =>
        Promise.resolve(POLICY),
    ),
    setCancellationPolicy: jest.fn(
      (_id: string, _dto: unknown, _user: AuthenticatedUser) =>
        Promise.resolve(POLICY),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AirlinePoliciesController],
      providers: [{ provide: AirlinePoliciesService, useValue: service }],
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

  const put = (path: string, body: object, id = AIRLINE_ID) =>
    request(app.getHttpServer())
      .put(`/api/airlines/${id}/${path}`)
      .set('x-test-user', MODERATOR_ID)
      .send(body);

  describe('PUT /api/airlines/:id/baggage-policy', () => {
    const BODY = { extraBagPrice: 25, maxExtraBagsPerPassenger: 2 };

    it('returns 200 with the policy, the airline id and the logged-in user', async () => {
      const res = await put('baggage-policy', BODY).expect(200);
      expect(res.body).toMatchObject({
        airlineId: AIRLINE_ID,
        extraBagPrice: '25.00',
        version: 3,
      });
      expect(service.setBaggagePolicy).toHaveBeenCalledTimes(1);
      const [id, dto, user] = service.setBaggagePolicy.mock.calls[0];
      expect(id).toBe(AIRLINE_ID);
      expect(dto).toEqual(BODY);
      expect(user).toMatchObject({ userId: MODERATOR_ID });
    });

    it('rejects bad values with field-level errors and does not call the service', async () => {
      const res = await put('baggage-policy', {
        extraBagPrice: 0,
        maxExtraBagsPerPassenger: -1,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [
          { field: 'extraBagPrice' },
          { field: 'maxExtraBagsPerPassenger' },
        ],
      });
      expect(service.setBaggagePolicy).not.toHaveBeenCalled();
    });

    it('rejects a bad airline id and client-supplied fields with 400', async () => {
      await put('baggage-policy', BODY, 'not-an-id').expect(400);
      await put('baggage-policy', { ...BODY, version: 99 }).expect(400);
      expect(service.setBaggagePolicy).not.toHaveBeenCalled();
    });

    it('passes a service error through in the standard error shape', async () => {
      service.setBaggagePolicy.mockRejectedValueOnce(
        new NotFoundException({
          code: 'AIRLINE_NOT_FOUND',
          message: 'Airline not found',
        }),
      );
      const res = await put('baggage-policy', BODY).expect(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        code: 'AIRLINE_NOT_FOUND',
        path: `/api/airlines/${AIRLINE_ID}/baggage-policy`,
      });
    });
  });

  describe('PUT /api/airlines/:id/cancellation-policy', () => {
    const BODY = {
      cancellationTiers: [
        { daysBeforeDeparture: 14, refundPercentage: 100 },
        { daysBeforeDeparture: 7, refundPercentage: 50 },
      ],
    };

    it('returns 200 with the policy', async () => {
      const res = await put('cancellation-policy', BODY).expect(200);
      expect(res.body.cancellationTiers).toHaveLength(2);
      expect(service.setCancellationPolicy.mock.calls[0][1]).toEqual(BODY);
    });

    it('accepts an empty list of tiers', async () => {
      await put('cancellation-policy', { cancellationTiers: [] }).expect(200);
    });

    it('rejects a repeated threshold and a percentage above 100', async () => {
      const duplicate = await put('cancellation-policy', {
        cancellationTiers: [
          { daysBeforeDeparture: 7, refundPercentage: 100 },
          { daysBeforeDeparture: 7, refundPercentage: 50 },
        ],
      }).expect(400);
      expect(duplicate.body.errors).toEqual([
        {
          field: 'cancellationTiers',
          messages: [
            'each daysBeforeDeparture threshold may be used only once',
          ],
        },
      ]);

      const percentage = await put('cancellation-policy', {
        cancellationTiers: [{ daysBeforeDeparture: 7, refundPercentage: 101 }],
      }).expect(400);
      expect(percentage.body.errors).toEqual([
        {
          field: 'cancellationTiers.0.refundPercentage',
          messages: ['refundPercentage must not be above 100'],
        },
      ]);
      expect(service.setCancellationPolicy).not.toHaveBeenCalled();
    });
  });
});
