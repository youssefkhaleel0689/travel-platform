// CORS for the frontend and no X-Powered-By, against the real app setup
// (configureApp). Reads only: it makes no change to the database.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

const CONNECT_TIMEOUT_MS = 120_000;
const FRONTEND = 'http://localhost:3001';

describe('HTTP headers: CORS and X-Powered-By (e2e)', () => {
  let app: INestApplication<App>;
  let saved: string | undefined;

  beforeAll(async () => {
    // The default origins, whatever the machine running the tests has set.
    saved = process.env.CORS_ORIGINS;
    delete process.env.CORS_ORIGINS;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    if (saved !== undefined) {
      process.env.CORS_ORIGINS = saved;
    }
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it('lets the frontend send a credentialed request: the preflight allows its origin and cookies', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', FRONTEND)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
  });

  it('names the frontend on the real response too, so the browser hands it the body', async () => {
    const res = await request(app.getHttpServer())
      .get('/api')
      .set('Origin', FRONTEND)
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow any other origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not say what the server runs on', async () => {
    const res = await request(app.getHttpServer()).get('/api').expect(200);

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
