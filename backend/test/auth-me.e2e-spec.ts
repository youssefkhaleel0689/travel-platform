// GET /api/auth/me and GET /api/users/me against the real app and database (ACC-04,
// ACC-11, ACC-19). Every user this test creates has an email starting with a prefix unique
// to the run, and afterAll deletes exactly those.
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

// Connecting to Atlas can take longer than Jest's default 5 seconds.
// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 90_000;
// Register and login compute real bcrypt hashes at the configured cost.
const REQUEST_TIMEOUT_MS = 15_000;

const PREFIX = `e2e-me-${Date.now()}-`;
const PASSWORD = 'Travel2026';

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

describe('GET /api/auth/me and /api/users/me (e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    userModel = app.get<Model<User>>(getModelToken(User.name));
    // The unique email index must exist before users are registered.
    await userModel.init();
  }, CONNECT_TIMEOUT_MS);

  // Deletes only this run's users, then closes the MongoDB connection.
  afterAll(async () => {
    await userModel.deleteMany({
      email: { $regex: `^${escapeRegExp(PREFIX)}` },
    });
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  // One user per path: the last tests suspend and then delete it.
  describe.each([
    ['/api/auth/me', 'auth'],
    ['/api/users/me', 'users'],
  ])('GET %s', (path, label) => {
    const email = `${PREFIX}${label}@example.com`;
    let registerCookie: string;

    function me(cookie?: string) {
      const req = request(app.getHttpServer()).get(path);
      return cookie ? req.set('Cookie', cookie) : req;
    }

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ name: 'Me Test', email, password: PASSWORD, acceptTerms: true })
        .expect(201);
      registerCookie = accessTokenCookie(res);
    }, REQUEST_TIMEOUT_MS);

    it('is 401 UNAUTHENTICATED without a cookie', async () => {
      const res = await me().expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    });

    it('is 401 with a garbage cookie', async () => {
      const res = await me('access_token=not-a-token').expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    });

    it('returns the profile for the register cookie, without private fields', async () => {
      const res = await me(registerCookie).expect(200);
      expect(res.body).toMatchObject({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        name: 'Me Test',
        email,
        role: 'USER',
        status: 'ACTIVE',
      });
      for (const key of [
        'passwordHash',
        'failedLoginAttempts',
        'lockedUntil',
      ]) {
        expect(res.body).not.toHaveProperty(key);
      }
    });

    it(
      'returns the same profile for a login cookie',
      async () => {
        const login = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200);

        const viaRegister = await me(registerCookie).expect(200);
        const viaLogin = await me(accessTokenCookie(login)).expect(200);
        expect(viaLogin.body).toEqual(viaRegister.body);
      },
      REQUEST_TIMEOUT_MS,
    );

    it('is 401 once the user is suspended', async () => {
      await userModel.updateOne({ email }, { status: UserStatus.SUSPENDED });
      const res = await me(registerCookie).expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    });

    it('is 401, not 500, once the user is deleted', async () => {
      await userModel.deleteOne({ email });
      const res = await me(registerCookie).expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    });
  });
});
