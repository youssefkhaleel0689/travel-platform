// ACC-05 account lockout against the real app and database: after 5 consecutive failed
// logins the account is locked for 15 minutes (423); a successful login resets the count.
// Every user this test creates has an email starting with a prefix unique to the run, and
// afterAll deletes exactly those.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { User } from './../src/auth/schemas/user.schema';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './../src/auth/users/login-lockout';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
const CONNECT_TIMEOUT_MS = 30_000;
// Every login computes a real bcrypt hash at the configured cost; the race sends ten at once.
const REQUEST_TIMEOUT_MS = 60_000;

const PREFIX = `e2e-lockout-${Date.now()}-`;
const PASSWORD = 'Travel2026';
const WRONG_PASSWORD = 'Wrong2026';

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

describe('Account lockout (e2e, ACC-05)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    // Listen once on a free port: supertest then reuses this server instead of calling
    // listen per request, which with 10 parallel requests raised MaxListenersExceededWarning.
    await app.listen(0);

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

  async function registerUser(label: string): Promise<string> {
    const email = `${PREFIX}${label}@example.com`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Lockout Test',
        email,
        password: PASSWORD,
        acceptTerms: true,
      })
      .expect(201);
    return email;
  }

  function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
  }

  async function stored(email: string): Promise<User | null> {
    return userModel.findOne({ email }).lean<User>().exec();
  }

  describe('one user, step by step', () => {
    let email: string;

    beforeAll(async () => {
      email = await registerUser('steps');
    }, REQUEST_TIMEOUT_MS);

    it(
      'answers 401 for 4 wrong passwords and 423 ACCOUNT_LOCKED for the 5th',
      async () => {
        for (let i = 1; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) {
          const res = await login(email, WRONG_PASSWORD).expect(401);
          expect(res.body.code).toBe('INVALID_CREDENTIALS');
        }

        const before = Date.now();
        const res = await login(email, WRONG_PASSWORD).expect(423);
        expect(res.body).toMatchObject({
          statusCode: 423,
          code: 'ACCOUNT_LOCKED',
          error: 'Locked',
          message: 'account locked, try again later',
        });
        expect(res.body).not.toHaveProperty('retryAfterSeconds');

        // About 15 minutes ahead of the request.
        const lockedUntil = Date.parse(res.body.details.lockedUntil);
        expect(lockedUntil - before).toBeGreaterThan(
          LOCKOUT_DURATION_MS - 60_000,
        );
        expect(lockedUntil - before).toBeLessThanOrEqual(
          LOCKOUT_DURATION_MS + 60_000,
        );

        const retryAfter = Number(res.headers['retry-after']);
        expect(Number.isInteger(retryAfter)).toBe(true);
        expect(retryAfter).toBeGreaterThanOrEqual(1);
        expect(retryAfter).toBeLessThanOrEqual(900);
        expect(setCookies(res)).toEqual([]);
      },
      REQUEST_TIMEOUT_MS,
    );

    it(
      'answers 423, not 200, to the right password while locked, and sets no cookie',
      async () => {
        const res = await login(email, PASSWORD).expect(423);
        expect(res.body.code).toBe('ACCOUNT_LOCKED');
        expect(
          setCookies(res).filter((c) => c.startsWith('access_token=')),
        ).toEqual([]);
      },
      REQUEST_TIMEOUT_MS,
    );

    it(
      'lets the right password in once the lock has expired, and resets the count',
      async () => {
        await userModel.updateOne(
          { email },
          { $set: { lockedUntil: new Date(Date.now() - 1000) } },
        );

        const res = await login(email, PASSWORD).expect(200);
        expect(res.body.email).toBe(email);

        const after = await stored(email);
        expect(after?.failedLoginAttempts).toBe(0);
        expect(after?.lockedUntil).toBeNull();
      },
      REQUEST_TIMEOUT_MS,
    );
  });

  it(
    'resets the count when the right password follows 4 wrong ones',
    async () => {
      const email = await registerUser('reset');
      for (let i = 1; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) {
        await login(email, WRONG_PASSWORD).expect(401);
      }

      const res = await login(email, PASSWORD).expect(200);
      expect(res.body.email).toBe(email);

      const after = await stored(email);
      expect(after?.failedLoginAttempts).toBe(0);
      expect(after?.lockedUntil).toBeNull();
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'heals a stuck last ticket: locks once, then lets the right password in after the lock',
    async () => {
      const email = await registerUser('stuck');
      // A request that took ticket 5 and died before writing the lock or the reset.
      await userModel.updateOne(
        { email },
        {
          $set: {
            failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
            lockedUntil: null,
          },
        },
      );

      const locked = await login(email, PASSWORD).expect(423);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
      const healed = await stored(email);
      expect(healed?.lockedUntil).toBeInstanceOf(Date);
      expect(healed?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
      expect(healed?.failedLoginAttempts).toBe(0);

      // The lock period ends.
      await userModel.updateOne(
        { email },
        { $set: { lockedUntil: new Date(Date.now() - 1000) } },
      );
      const res = await login(email, PASSWORD).expect(200);
      expect(res.body.email).toBe(email);
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'counts parallel failures atomically: 10 at once give 4 × 401 and 6 × 423',
    async () => {
      const email = await registerUser('race');
      const results = await Promise.all(
        Array.from({ length: 10 }, () => login(email, WRONG_PASSWORD)),
      );

      const statuses = results.map((res) => res.status);
      expect(statuses.filter((s) => s === 401)).toHaveLength(4);
      expect(statuses.filter((s) => s === 423)).toHaveLength(6);

      const after = await stored(email);
      expect(after?.lockedUntil).toBeInstanceOf(Date);
      expect(after?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'gives an unknown email the same 401 body as a wrong password',
    async () => {
      const email = await registerUser('unknown-check');
      const wrong = await login(email, WRONG_PASSWORD).expect(401);
      const unknown = await login(
        `${PREFIX}nobody@example.com`,
        WRONG_PASSWORD,
      ).expect(401);

      expect(withoutTimestamp(unknown.body)).toEqual(
        withoutTimestamp(wrong.body),
      );
    },
    REQUEST_TIMEOUT_MS,
  );
});
