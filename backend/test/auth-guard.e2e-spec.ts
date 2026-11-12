// The global guards against the real app and database (ACC-04, ACC-11, ACC-19).
// Every user this test creates has an email starting with a prefix unique to the run,
// every airline name starts with the same prefix, and afterAll deletes exactly those.
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { jwtModuleOptions } from './../src/auth/jwt-secret';
import { User } from './../src/auth/schemas/user.schema';
import { UserStatus } from './../src/common/auth/auth.enums';
import { Airline } from './../src/flights/schemas/airline.schema';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
const CONNECT_TIMEOUT_MS = 30_000;
// Registration computes a real bcrypt hash at the configured cost.
const REQUEST_TIMEOUT_MS = 15_000;

const PREFIX = `e2e-guard-${Date.now()}-`;
// A secret that is certainly not the app's JWT_SECRET (test only).
const OTHER_SECRET = `${PREFIX}not-the-app-secret-0123456789abcdef`;

const UNAUTHENTICATED = {
  statusCode: 401,
  code: 'UNAUTHENTICATED',
  message: 'Authentication required',
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The access_token cookie from a response, as "access_token=<token>".
function accessTokenCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw)
    ? raw.filter((cookie): cookie is string => typeof cookie === 'string')
    : [];
  const cookie = cookies.find((c) => c.startsWith('access_token='));
  if (!cookie) {
    throw new Error('the response set no access_token cookie');
  }
  return cookie.split(';')[0];
}

describe('Global auth guards (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let airlineModel: Model<Airline>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    userModel = app.get<Model<User>>(getModelToken(User.name));
    airlineModel = app.get<Model<Airline>>(getModelToken(Airline.name));
    // The unique email index must exist before users are registered.
    await userModel.init();
  }, CONNECT_TIMEOUT_MS);

  // Deletes only this run's users and airlines, then closes the MongoDB connection.
  afterAll(async () => {
    const mine = { $regex: `^${escapeRegExp(PREFIX)}` };
    await airlineModel.deleteMany({ name: mine });
    await userModel.deleteMany({ email: mine });
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  function server() {
    return app.getHttpServer();
  }

  // A valid body for POST /api/airlines, unique to this run.
  const airlineBody = {
    name: `${PREFIX}airline`,
    iataCode: 'Z9',
  };

  describe('public routes answer without a cookie', () => {
    it.each([
      '/api/airports',
      '/api/countries',
      '/api/cities',
      '/api/currencies',
    ])('GET %s is 200', async (path) => {
      await request(server()).get(path).expect(200);
    });

    it('GET /api is 200', async () => {
      await request(server()).get('/api').expect(200);
    });

    it('GET /api/airlines/:id is 404 AIRLINE_NOT_FOUND, not 401', async () => {
      const res = await request(server())
        .get(`/api/airlines/${new Types.ObjectId().toString()}`)
        .expect(404);
      expect(res.body.code).toBe('AIRLINE_NOT_FOUND');
    });

    it('GET /api/airlines/:id with a garbage cookie is still 404, not 401', async () => {
      const res = await request(server())
        .get(`/api/airlines/${new Types.ObjectId().toString()}`)
        .set('Cookie', 'access_token=not-a-token')
        .expect(404);
      expect(res.body.code).toBe('AIRLINE_NOT_FOUND');
    });
  });

  describe('protected routes reject a missing or invalid session', () => {
    it('POST /api/airlines without a cookie is 401', async () => {
      const res = await request(server())
        .post('/api/airlines')
        .send(airlineBody)
        .expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    });

    it('POST /api/airlines with a garbage cookie is 401', async () => {
      const res = await request(server())
        .post('/api/airlines')
        .set('Cookie', 'access_token=not-a-token')
        .send(airlineBody)
        .expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    });

    it('POST /api/airlines with a token signed by another secret is 401', async () => {
      const forger = new JwtService(jwtModuleOptions(OTHER_SECRET));
      const token = await forger.signAsync({
        sub: new Types.ObjectId().toString(),
      });
      const res = await request(server())
        .post('/api/airlines')
        .set('Cookie', `access_token=${token}`)
        .send(airlineBody)
        .expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    });
  });

  describe('a logged-in USER', () => {
    const email = `${PREFIX}user@example.com`;
    let cookie: string;

    beforeAll(async () => {
      const res = await request(server())
        .post('/api/auth/register')
        .send({
          name: 'Guard Test',
          email,
          password: 'Travel2026',
          acceptTerms: true,
        })
        .expect(201);
      cookie = accessTokenCookie(res);
    }, REQUEST_TIMEOUT_MS);

    it('gets 403 FORBIDDEN from the service and creates no airline', async () => {
      const res = await request(server())
        .post('/api/airlines')
        .set('Cookie', cookie)
        .send(airlineBody)
        .expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      // Proves the placeholder admin is no longer used for a real user.
      expect(
        await airlineModel.countDocuments({ name: airlineBody.name }),
      ).toBe(0);
    });

    it('gets 401 once suspended, with the same cookie', async () => {
      await userModel.updateOne({ email }, { status: UserStatus.SUSPENDED });

      const res = await request(server())
        .post('/api/airlines')
        .set('Cookie', cookie)
        .send(airlineBody)
        .expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
      expect(
        await airlineModel.countDocuments({ name: airlineBody.name }),
      ).toBe(0);
    });
  });
});
