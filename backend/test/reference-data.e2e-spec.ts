// This test reads the seeded reference data on the shared database and writes
// nothing. Run `npm run seed` first.
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 120_000;

describe('Reference data (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }, CONNECT_TIMEOUT_MS);

  // Also closes the MongoDB connection.
  afterAll(async () => {
    await app.close();
  });

  const timestamp = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);

  describe('lists', () => {
    it.each([
      ['/api/airports', 8],
      ['/api/countries', 8],
      ['/api/cities', 8],
      ['/api/currencies', 7],
    ])('%s returns a page of %i items', async (path, totalItems) => {
      const res = await request(app.getHttpServer()).get(path).expect(200);

      expect(res.body.meta).toEqual({
        page: 1,
        pageSize: 10,
        totalItems,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(res.body.items).toHaveLength(totalItems);
      for (const item of res.body.items) {
        expect(item).toHaveProperty('id');
        expect(item).not.toHaveProperty('_id');
      }
    });
  });

  describe('filters', () => {
    it('returns only CAI for cityId=cairo', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/airports?cityId=cairo')
        .expect(200);

      expect(res.body.items).toEqual([
        {
          id: 'CAI',
          name: 'Cairo International Airport',
          cityId: 'cairo',
          countryId: 'EG',
          timeZone: 'Africa/Cairo',
        },
      ]);
      expect(res.body.meta.totalItems).toBe(1);
    });

    it('returns only frankfurt for countryId=DE', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/cities?countryId=DE')
        .expect(200);

      expect(res.body.items).toEqual([
        { id: 'frankfurt', name: 'Frankfurt', countryId: 'DE' },
      ]);
      expect(res.body.meta.totalItems).toBe(1);
    });

    it('returns an empty page for an unknown but well-formed filter', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/cities?countryId=ZZ')
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
      expect(res.body.meta.totalPages).toBe(0);
    });
  });

  describe('invalid queries', () => {
    it.each([
      ['a malformed filter', '/api/cities', 'countryId=egypt'],
      ['an injection attempt', '/api/airports', 'cityId[$ne]=cairo'],
      ['an unknown parameter', '/api/airports', 'limit=50'],
    ])('rejects %s with the error format', async (_name, path, query) => {
      const res = await request(app.getHttpServer())
        .get(`${path}?${query}`)
        .expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        error: 'Bad Request',
        message: 'Validation failed',
        errors: expect.any(Array),
        path,
        timestamp,
      });
      expect(res.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Swagger document', () => {
    it.each(['airports', 'countries', 'cities', 'currencies'])(
      'documents /api/%s under the "Reference data" tag',
      (name) => {
        const document = SwaggerModule.createDocument(
          app,
          new DocumentBuilder().build(),
        );
        const operation = document.paths[`/api/${name}`]?.get;

        expect(operation?.tags).toContain('Reference data');
      },
    );
  });
});
