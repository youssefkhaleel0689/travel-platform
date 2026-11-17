// ACC-06 logout against the real app and database: POST /api/auth/logout always answers 204,
// clears both cookies and ends the session found through the access or the refresh cookie,
// leaving the user's other sessions alone. Every user this test creates has an email starting
// with a prefix unique to the run; afterAll deletes those users and their sessions.
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

const PREFIX = `e2e-logout-${Date.now()}-`;
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

// The cookie `name` set by a response, as "name=value" for a Cookie header.
function cookie(
  res: { headers: Record<string, unknown> },
  name: string,
): string {
  const found = setCookies(res).find((c) => c.startsWith(`${name}=`));
  if (!found) {
    throw new Error(`the response set no ${name} cookie`);
  }
  return found.split(';')[0];
}

// True when the response clears the cookie `name` (an empty value that has expired).
function clears(
  res: { headers: Record<string, unknown> },
  name: string,
): boolean {
  return setCookies(res).some(
    (c) => c.startsWith(`${name}=;`) && c.includes('Expires=Thu, 01 Jan 1970'),
  );
}

describe('POST /api/auth/logout (e2e, ACC-06)', () => {
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
  }, CONNECT_TIMEOUT_MS);

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

  // Registers a fresh user (which logs it in and starts one session) and returns its email
  // and the "name=value" access and refresh cookies.
  async function registered(label: string) {
    const email = `${PREFIX}${label}@example.com`;
    const res = await request(server())
      .post('/api/auth/register')
      .send({
        name: 'Logout Test',
        email,
        password: PASSWORD,
        acceptTerms: true,
      })
      .expect(201);
    return {
      email,
      access: cookie(res, 'access_token'),
      refresh: cookie(res, 'refresh_token'),
    };
  }

  function logout(...cookies: string[]) {
    const req = request(server()).post('/api/auth/logout');
    return cookies.length > 0 ? req.set('Cookie', cookies.join('; ')) : req;
  }

  function me(access: string) {
    return request(server()).get('/api/auth/me').set('Cookie', access);
  }

  function refresh(refreshCookie: string) {
    return request(server())
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);
  }

  it(
    'a) with both cookies: 204, clears both, and neither old cookie works afterwards',
    async () => {
      const { access, refresh: refreshCookie } = await registered('both');
      await me(access).expect(200);

      const res = await logout(access, refreshCookie).expect(204);
      expect(res.text).toBe('');
      expect(clears(res, 'access_token')).toBe(true);
      expect(clears(res, 'refresh_token')).toBe(true);

      await me(access).expect(401);
      await refresh(refreshCookie).expect(401);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'b) with only the refresh cookie: 204, and that refresh cookie stops working',
    async () => {
      const { access, refresh: refreshCookie } =
        await registered('refresh-only');

      const res = await logout(refreshCookie).expect(204);
      expect(clears(res, 'access_token')).toBe(true);
      expect(clears(res, 'refresh_token')).toBe(true);

      await refresh(refreshCookie).expect(401);
      // The session is revoked, so the access cookie of the same session stops too.
      await me(access).expect(401);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'c) with no cookies: 204, and both cookies are still cleared',
    async () => {
      const res = await logout().expect(204);
      expect(clears(res, 'access_token')).toBe(true);
      expect(clears(res, 'refresh_token')).toBe(true);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'd) twice with the same cookies: 204 both times',
    async () => {
      const { access, refresh: refreshCookie } = await registered('twice');

      await logout(access, refreshCookie).expect(204);
      await logout(access, refreshCookie).expect(204);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'e) logging out one of two sessions leaves the other working',
    async () => {
      const first = await registered('two-sessions');
      const second = await request(server())
        .post('/api/auth/login')
        .send({ email: first.email, password: PASSWORD })
        .expect(200);
      const secondAccess = cookie(second, 'access_token');

      await logout(first.access, first.refresh).expect(204);

      await me(first.access).expect(401);
      const still = await me(secondAccess).expect(200);
      expect(still.body.email).toBe(first.email);
    },
    REQUEST_TIMEOUT_MS,
  );
});
