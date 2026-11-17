// ACC-06 sessions against the real app and database: login starts a session and sets the
// access and refresh cookies; the guard accepts the access cookie only while its session is
// live, and rejects a token without a session id. Every user this test creates has an email
// starting with a prefix unique to the run; afterAll deletes those users and their sessions.
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { User } from './../src/auth/schemas/user.schema';
import { SESSION_ABSOLUTE_LIFETIME_MS } from './../src/auth/sessions/session.constants';
import { Session } from './../src/auth/sessions/session.schema';
import { SessionsService } from './../src/auth/sessions/sessions.service';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
const CONNECT_TIMEOUT_MS = 30_000;
// Register and login each compute a real bcrypt hash at the configured cost.
const REQUEST_TIMEOUT_MS = 30_000;

const PREFIX = `e2e-sessions-${Date.now()}-`;
const PASSWORD = 'Travel2026';

const UNAUTHENTICATED = {
  statusCode: 401,
  code: 'UNAUTHENTICATED',
  message: 'Authentication required',
};

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

// The one Set-Cookie header for `name`, split into its "; "-separated parts.
function cookieParts(
  res: { headers: Record<string, unknown> },
  name: string,
): string[] {
  const cookies = setCookies(res).filter((c) => c.startsWith(`${name}=`));
  expect(cookies).toHaveLength(1);
  return cookies[0].split('; ');
}

describe('Sessions (e2e, ACC-06)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let sessions: SessionsService;
  let jwt: JwtService;

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
    sessions = app.get(SessionsService);
    // The app's own JwtService: signs with the real secret without this test reading it.
    jwt = app.get(JwtService);
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

  // Registers a fresh user, then logs in; returns the login response.
  async function registerAndLogin(label: string) {
    const email = `${PREFIX}${label}@example.com`;
    await request(server())
      .post('/api/auth/register')
      .send({
        name: 'Sessions Test',
        email,
        password: PASSWORD,
        acceptTerms: true,
      })
      .expect(201);
    return request(server())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  }

  function me(cookie: string) {
    return request(server()).get('/api/auth/me').set('Cookie', cookie);
  }

  it(
    'login sets the access and refresh cookies with the right attributes, never a token in the body',
    async () => {
      const before = Date.now();
      const res = await registerAndLogin('cookies');

      const access = cookieParts(res, 'access_token');
      for (const attribute of [
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Path=/',
        'Max-Age=1800',
      ]) {
        expect(access).toContain(attribute);
      }

      const refresh = cookieParts(res, 'refresh_token');
      for (const attribute of [
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Path=/api/auth',
      ]) {
        expect(refresh).toContain(attribute);
      }
      // Max-Age: the seconds left until the session's absolute end (5 hours).
      const maxAge = Number(
        refresh.find((p) => p.startsWith('Max-Age='))?.slice('Max-Age='.length),
      );
      const lifetime = SESSION_ABSOLUTE_LIFETIME_MS / 1000;
      expect(maxAge).toBeLessThanOrEqual(lifetime);
      expect(maxAge).toBeGreaterThan(
        lifetime - Math.ceil((Date.now() - before) / 1000) - 5,
      );

      const body = JSON.stringify(res.body);
      expect(body).not.toContain(access[0].slice('access_token='.length));
      expect(body).not.toContain(refresh[0].slice('refresh_token='.length));
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'accepts the access cookie on /api/auth/me while the session is live, and 401 once it is revoked',
    async () => {
      const res = await registerAndLogin('revoke');
      const cookie = cookieParts(res, 'access_token')[0];

      const ok = await me(cookie).expect(200);
      expect(ok.body.id).toBe(res.body.id);

      // The session id is the token's sid claim.
      const payload = jwt.decode<{ sub: string; sid: string }>(
        cookie.slice('access_token='.length),
      );
      expect(payload.sub).toBe(res.body.id);
      expect(payload.sid).toMatch(/^[0-9a-f]{24}$/);

      await sessions.revoke(payload.sid);

      const rejected = await me(cookie).expect(401);
      expect(rejected.body).toMatchObject(UNAUTHENTICATED);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'rejects a token signed with the real secret but without sid',
    async () => {
      const res = await registerAndLogin('no-sid');
      const token = await jwt.signAsync({ sub: res.body.id });

      const rejected = await me(`access_token=${token}`).expect(401);
      expect(rejected.body).toMatchObject(UNAUTHENTICATED);
    },
    REQUEST_TIMEOUT_MS,
  );
});
