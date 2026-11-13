// POST /api/auth/login against the real app and database (ACC-04). Every user this test
// creates has an email starting with a prefix unique to the run, every airline name starts
// with the same prefix, and afterAll deletes exactly those.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { User } from './../src/auth/schemas/user.schema';
import { UserStatus } from './../src/common/auth/auth.enums';
import { Airline } from './../src/flights/schemas/airline.schema';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 90_000;
// Register and login compute real bcrypt hashes at the configured cost.
const REQUEST_TIMEOUT_MS = 15_000;

const PREFIX = `e2e-login-${Date.now()}-`;
const EMAIL = `${PREFIX}user@example.com`;
const PASSWORD = 'Travel2026';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The Set-Cookie headers of a response (none when the header is absent).
function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw)
    ? raw.filter((cookie): cookie is string => typeof cookie === 'string')
    : [];
}

// An error body without its timestamp, to compare two error responses.
function withoutTimestamp(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== 'timestamp'),
  );
}

describe('POST /api/auth/login (e2e)', () => {
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

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Login Test',
        email: EMAIL,
        password: PASSWORD,
        acceptTerms: true,
      })
      .expect(201);
  }, CONNECT_TIMEOUT_MS + REQUEST_TIMEOUT_MS);

  // Deletes only this run's users and airlines, then closes the MongoDB connection.
  afterAll(async () => {
    const mine = { $regex: `^${escapeRegExp(PREFIX)}` };
    await airlineModel.deleteMany({ name: mine });
    await userModel.deleteMany({ email: mine });
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  function login(payload: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/auth/login').send(payload);
  }

  describe('an ACTIVE user', () => {
    it(
      'gets 200, the profile and the httpOnly cookie, never a token or hash in the body',
      async () => {
        const res = await login({ email: EMAIL, password: PASSWORD }).expect(
          200,
        );

        expect(res.body).toMatchObject({
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          email: EMAIL,
          role: 'USER',
          status: 'ACTIVE',
        });
        expect(res.body).not.toHaveProperty('passwordHash');

        const cookies = setCookies(res).filter((cookie) =>
          cookie.startsWith('access_token='),
        );
        expect(cookies).toHaveLength(1);
        const parts = cookies[0].split('; ');
        for (const attribute of [
          'HttpOnly',
          'Secure',
          'SameSite=Lax',
          'Path=/',
          'Max-Age=1800',
        ]) {
          expect(parts).toContain(attribute);
        }
        const token = parts[0].slice('access_token='.length);
        expect(token.split('.')).toHaveLength(3);
        expect(JSON.stringify(res.body)).not.toContain(token);
      },
      REQUEST_TIMEOUT_MS,
    );

    it(
      'can type the email in capitals with spaces',
      async () => {
        await login({
          email: `  ${EMAIL.toUpperCase()}  `,
          password: PASSWORD,
        }).expect(200);
      },
      REQUEST_TIMEOUT_MS,
    );

    it(
      'is authenticated on a protected route by the login cookie (403 from the service, not 401)',
      async () => {
        const res = await login({ email: EMAIL, password: PASSWORD }).expect(
          200,
        );
        const cookie = setCookies(res)
          .find((c) => c.startsWith('access_token='))
          ?.split(';')[0];
        expect(cookie).toBeDefined();

        const name = `${PREFIX}airline`;
        const write = await request(app.getHttpServer())
          .post('/api/airlines')
          .set('Cookie', cookie ?? '')
          .send({ name, iataCode: 'Z8' })
          .expect(403);
        expect(write.body.code).toBe('FORBIDDEN');
        expect(await airlineModel.countDocuments({ name })).toBe(0);
      },
      REQUEST_TIMEOUT_MS,
    );
  });

  describe('wrong credentials', () => {
    it(
      'gives the same 401 for a wrong password and an unknown email, with no cookie',
      async () => {
        const wrong = await login({
          email: EMAIL,
          password: 'Wrong2026',
        }).expect(401);
        const unknown = await login({
          email: `${PREFIX}nobody@example.com`,
          password: PASSWORD,
        }).expect(401);

        expect(wrong.body).toMatchObject({
          statusCode: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'invalid email or password',
        });
        expect(withoutTimestamp(unknown.body)).toEqual(
          withoutTimestamp(wrong.body),
        );
        expect(setCookies(wrong)).toEqual([]);
        expect(setCookies(unknown)).toEqual([]);
      },
      REQUEST_TIMEOUT_MS * 2,
    );
  });

  describe('validation (400)', () => {
    it('rejects a missing password', async () => {
      const res = await login({ email: EMAIL }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      const fields = (res.body.errors as { field: string }[]).map(
        (e) => e.field,
      );
      expect(fields).toContain('password');
      expect(setCookies(res)).toEqual([]);
    });

    it('rejects an extra field', async () => {
      const res = await login({
        email: EMAIL,
        password: PASSWORD,
        role: 'ADMIN',
      }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(setCookies(res)).toEqual([]);
    });
  });

  // Last: these change the test user's status.
  describe.each([
    [UserStatus.SUSPENDED, 'ACCOUNT_SUSPENDED', 'account suspended'],
    [UserStatus.DEACTIVATED, 'ACCOUNT_DEACTIVATED', 'account deactivated'],
  ])('a %s account', (status, code, message) => {
    beforeAll(async () => {
      await userModel.updateOne({ email: EMAIL }, { status });
    });

    it(
      `gets 403 ${code} with the right password, and no cookie`,
      async () => {
        const res = await login({ email: EMAIL, password: PASSWORD }).expect(
          403,
        );
        expect(res.body).toMatchObject({ statusCode: 403, code, message });
        expect(setCookies(res)).toEqual([]);
      },
      REQUEST_TIMEOUT_MS,
    );

    it(
      'gets 401 INVALID_CREDENTIALS with a wrong password, so the status is not revealed',
      async () => {
        const res = await login({ email: EMAIL, password: 'Wrong2026' }).expect(
          401,
        );
        expect(res.body.code).toBe('INVALID_CREDENTIALS');
        expect(setCookies(res)).toEqual([]);
      },
      REQUEST_TIMEOUT_MS,
    );
  });
});
