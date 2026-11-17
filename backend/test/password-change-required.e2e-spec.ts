// ACC-11 (with ACC-07a, ACC-13) against the real app and database: a user whose
// mustChangePassword flag is set can log in, refresh, log out and call /api/auth/me, but
// gets 403 PASSWORD_CHANGE_REQUIRED on other protected routes until the flag is cleared.
// Every user this test creates has an email starting with a prefix unique to the run;
// afterAll deletes those users and their sessions.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { User } from './../src/auth/schemas/user.schema';
import { Session } from './../src/auth/sessions/session.schema';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
const CONNECT_TIMEOUT_MS = 30_000;
// Register and login each compute a real bcrypt hash at the configured cost.
const REQUEST_TIMEOUT_MS = 30_000;

const PREFIX = `e2e-pwchange-${Date.now()}-`;
const EMAIL = `${PREFIX}user@example.com`;
const PASSWORD = 'Travel2026';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The cookie `name` set by a response, as "name=value" for a Cookie header.
function cookie(
  res: { headers: Record<string, unknown> },
  name: string,
): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw)
    ? raw.filter((c): c is string => typeof c === 'string')
    : [];
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  if (!found) {
    throw new Error(`the response set no ${name} cookie`);
  }
  return found.split(';')[0];
}

describe('mustChangePassword (e2e, ACC-11)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    // Listen once, so supertest reuses this server instead of starting one per request.
    await app.listen(0);

    userModel = app.get<Model<User>>(getModelToken(User.name));
    sessionModel = app.get<Model<Session>>(getModelToken(Session.name));
    // The unique indexes must exist before users and sessions are created.
    await userModel.init();
    await sessionModel.init();

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Password Change Test',
        email: EMAIL,
        password: PASSWORD,
        acceptTerms: true,
      })
      .expect(201);
    await userModel.updateOne(
      { email: EMAIL },
      { $set: { mustChangePassword: true } },
    );
  }, CONNECT_TIMEOUT_MS + REQUEST_TIMEOUT_MS);

  // Deletes only this run's users and their sessions, then closes the MongoDB connection.
  afterAll(async () => {
    const mine = await userModel
      .find({ email: { $regex: `^${escapeRegExp(PREFIX)}` } })
      .select('_id')
      .lean<Pick<User, '_id'>[]>()
      .exec();
    const ids = mine.map((user) => user._id);
    await sessionModel.deleteMany({ userId: { $in: ids } });
    await userModel.deleteMany({ _id: { $in: ids } });
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  function server() {
    return app.getHttpServer();
  }

  function login() {
    return request(server())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
  }

  describe('with the flag set', () => {
    let access: string;
    let refresh: string;

    it(
      'a) logs in with 200, and the body says mustChangePassword: true',
      async () => {
        const res = await login().expect(200);
        expect(res.body).toMatchObject({
          email: EMAIL,
          mustChangePassword: true,
        });
        access = cookie(res, 'access_token');
        refresh = cookie(res, 'refresh_token');
      },
      REQUEST_TIMEOUT_MS,
    );

    it('b) GET /api/auth/me answers 200', async () => {
      const res = await request(server())
        .get('/api/auth/me')
        .set('Cookie', access)
        .expect(200);
      expect(res.body.mustChangePassword).toBe(true);
    });

    it('c) GET /api/users/me answers 403 PASSWORD_CHANGE_REQUIRED', async () => {
      const res = await request(server())
        .get('/api/users/me')
        .set('Cookie', access)
        .expect(403);
      expect(res.body).toMatchObject({
        statusCode: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'password change required',
      });
    });

    it('d) refresh answers 200 and logout answers 204', async () => {
      const refreshed = await request(server())
        .post('/api/auth/refresh')
        .set('Cookie', refresh)
        .expect(200);
      expect(refreshed.body.mustChangePassword).toBe(true);

      await request(server())
        .post('/api/auth/logout')
        .set(
          'Cookie',
          [
            cookie(refreshed, 'access_token'),
            cookie(refreshed, 'refresh_token'),
          ].join('; '),
        )
        .expect(204);
    });
  });

  it(
    'e) once the flag is cleared, the very next request to /api/users/me answers 200',
    async () => {
      const res = await login().expect(200);
      const access = cookie(res, 'access_token');
      await request(server())
        .get('/api/users/me')
        .set('Cookie', access)
        .expect(403);

      await userModel.updateOne(
        { email: EMAIL },
        { $set: { mustChangePassword: false } },
      );

      const me = await request(server())
        .get('/api/users/me')
        .set('Cookie', access)
        .expect(200);
      expect(me.body.mustChangePassword).toBe(false);
    },
    REQUEST_TIMEOUT_MS,
  );
});
