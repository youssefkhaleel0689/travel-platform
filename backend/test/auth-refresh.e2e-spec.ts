// ACC-06 refresh against the real app and database: POST /api/auth/refresh rotates the
// refresh token, refuses an old, idle or expired one, and lets exactly one of two concurrent
// refreshes with the same token through. Every user this test creates has an email starting
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
import { SESSION_IDLE_TIMEOUT_MS } from './../src/auth/sessions/session.constants';
import { Session } from './../src/auth/sessions/session.schema';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
const CONNECT_TIMEOUT_MS = 30_000;
// Registration computes a real bcrypt hash at the configured cost.
const REQUEST_TIMEOUT_MS = 30_000;

const PREFIX = `e2e-refresh-${Date.now()}-`;
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

// The value of the cookie `name` set by a response, or undefined.
function cookieValue(
  res: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const cookie = setCookies(res).find((c) => c.startsWith(`${name}=`));
  return cookie?.split(';')[0].slice(name.length + 1);
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

describe('POST /api/auth/refresh (e2e, ACC-06)', () => {
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

  // Registers a fresh user (which logs it in and starts one session). Returns the user id
  // and the refresh token from the registration cookies.
  async function registered(
    label: string,
  ): Promise<{ userId: string; refreshToken: string }> {
    const res = await request(server())
      .post('/api/auth/register')
      .send({
        name: 'Refresh Test',
        email: `${PREFIX}${label}@example.com`,
        password: PASSWORD,
        acceptTerms: true,
      })
      .expect(201);
    const refreshToken = cookieValue(res, 'refresh_token');
    expect(refreshToken).toBeDefined();
    return { userId: res.body.id, refreshToken: refreshToken ?? '' };
  }

  function refresh(refreshToken?: string) {
    const req = request(server()).post('/api/auth/refresh');
    return refreshToken === undefined
      ? req
      : req.set('Cookie', `refresh_token=${refreshToken}`);
  }

  it(
    'a) returns 200 with the profile and sets new access and refresh cookies',
    async () => {
      const { userId, refreshToken } = await registered('rotate');

      const res = await refresh(refreshToken).expect(200);
      expect(res.body).toMatchObject({ id: userId, status: 'ACTIVE' });

      const access = cookieValue(res, 'access_token');
      const rotated = cookieValue(res, 'refresh_token');
      expect(access?.split('.')).toHaveLength(3);
      expect(rotated).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(rotated).not.toBe(refreshToken);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain(access ?? '<none>');
      expect(body).not.toContain(rotated ?? '<none>');

      // The new access cookie works on a protected route.
      await request(server())
        .get('/api/auth/me')
        .set('Cookie', `access_token=${access ?? ''}`)
        .expect(200);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'b) rejects the old refresh token after rotation, and clears both cookies',
    async () => {
      const { refreshToken } = await registered('old');
      await refresh(refreshToken).expect(200);

      const res = await refresh(refreshToken).expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
      expect(clears(res, 'access_token')).toBe(true);
      expect(clears(res, 'refresh_token')).toBe(true);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'c) lets exactly one of two concurrent refreshes with the same token through',
    async () => {
      const { refreshToken } = await registered('race');

      const results = await Promise.all([
        refresh(refreshToken),
        refresh(refreshToken),
      ]);
      expect(results.map((res) => res.status).sort((a, b) => a - b)).toEqual([
        200, 401,
      ]);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'd) refuses an idle session (no activity for more than 30 minutes)',
    async () => {
      const { userId, refreshToken } = await registered('idle');
      await sessionModel.updateOne(
        { userId },
        {
          $set: {
            lastActivityAt: new Date(
              Date.now() - SESSION_IDLE_TIMEOUT_MS - 60_000,
            ),
          },
        },
      );

      const res = await refresh(refreshToken).expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'e) refuses a session past its absolute end (expiresAt)',
    async () => {
      const { userId, refreshToken } = await registered('expired');
      await sessionModel.updateOne(
        { userId },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

      const res = await refresh(refreshToken).expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'f) answers 401 without a cookie',
    async () => {
      const res = await refresh().expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    },
    REQUEST_TIMEOUT_MS,
  );
});
