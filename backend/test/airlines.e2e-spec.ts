import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AirlinesController } from './../src/flights/airlines/airlines.controller';
import type { AirlineActor } from './../src/flights/airlines/airline-actor';
import { AirlinesService } from './../src/flights/airlines/airlines.service';
import { AirlineDto } from './../src/flights/airlines/dto/airline.dto';
import { configureApp } from './../src/app.setup';

// Routing, validation and error shape of the real controller with a fake service:
// no MongoDB, so it runs anywhere. The service rules have their own unit tests.
const ID = '6720f1c2a1b2c3d4e5f60718';
const AIRLINE: AirlineDto = {
  id: ID,
  name: 'EgyptAir',
  iataCode: 'MS',
  icaoCode: 'MSR',
  logo: null,
  status: 'ACTIVE' as AirlineDto['status'],
  createdAt: '2026-11-09T10:00:00.000Z',
  updatedAt: '2026-11-09T10:00:00.000Z',
};

describe('Airlines (e2e, fake service)', () => {
  let app: INestApplication<App>;
  const service = {
    create: jest.fn(
      (_dto: unknown, _actor: AirlineActor): Promise<AirlineDto> =>
        Promise.resolve(AIRLINE),
    ),
    findOne: jest.fn(
      (_id: string, _actor?: AirlineActor): Promise<AirlineDto> =>
        Promise.resolve(AIRLINE),
    ),
    update: jest.fn(
      (_id: string, _dto: unknown, _actor: AirlineActor): Promise<AirlineDto> =>
        Promise.resolve(AIRLINE),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AirlinesController],
      providers: [{ provide: AirlinesService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('POST /api/airlines creates with 201 and normalised codes', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/airlines')
      .send({ name: 'EgyptAir', iataCode: 'ms', icaoCode: 'msr' })
      .expect(201);
    expect(res.body).toMatchObject({ id: ID, iataCode: 'MS' });
    expect(service.create.mock.calls[0][0]).toMatchObject({
      iataCode: 'MS',
      icaoCode: 'MSR',
    });
    // TODO(ACC-04): runs as the placeholder admin until auth is merged.
    expect(service.create.mock.calls[0][1].role).toBe('ADMIN');
  });

  it('POST returns field-level errors for a bad body (GEN-02)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/airlines')
      .send({ name: '', iataCode: 'MSR' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const fields = (res.body.errors as { field: string }[]).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'iataCode']));
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each(['status', 'logo', 'createdBy'])(
    'POST rejects the client-supplied field %s',
    async (field) => {
      const res = await request(app.getHttpServer())
        .post('/api/airlines')
        .send({ name: 'EgyptAir', iataCode: 'MS', [field]: 'ACTIVE' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(service.create).not.toHaveBeenCalled();
    },
  );

  it('GET /api/airlines/:id is public and passes no actor', async () => {
    await request(app.getHttpServer()).get(`/api/airlines/${ID}`).expect(200);
    expect(service.findOne).toHaveBeenCalledWith(ID, undefined);
  });

  it('GET rejects a malformed id with a field error', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/airlines/not-an-id')
      .expect(400);
    expect(res.body.errors).toEqual([
      { field: 'id', messages: expect.any(Array) },
    ]);
  });

  it('GET returns the shared 404 error shape', async () => {
    service.findOne.mockRejectedValueOnce(
      new NotFoundException({
        code: 'AIRLINE_NOT_FOUND',
        message: 'Airline not found',
      }),
    );
    const res = await request(app.getHttpServer())
      .get(`/api/airlines/${ID}`)
      .expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'AIRLINE_NOT_FOUND',
    });
  });

  it('PATCH /api/airlines/:id updates and rejects status and logo', async () => {
    await request(app.getHttpServer())
      .patch(`/api/airlines/${ID}`)
      .send({ name: 'EgyptAir Express' })
      .expect(200);
    expect(service.update.mock.calls[0][0]).toBe(ID);

    await request(app.getHttpServer())
      .patch(`/api/airlines/${ID}`)
      .send({ status: 'DEACTIVATED' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/airlines/${ID}`)
      .send({ logo: 'http://x/y.png' })
      .expect(400);
    expect(service.update).toHaveBeenCalledTimes(1);
  });
});
