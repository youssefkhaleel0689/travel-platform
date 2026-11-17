// POST /api/auth/register against the real database (ACC-01, GEN-13). Every email starts
// with a prefix unique to this run, and afterAll deletes exactly those users.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { User } from './../src/auth/schemas/user.schema';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 120_000;
// Each registration computes a real bcrypt hash at the configured cost.
const REQUEST_TIMEOUT_MS = 15_000;

const PREFIX = `e2e-register-${Date.now()}-`;
const PASSWORD = 'Travel2026';

let counter = 0;
// A new, lower-case email for this run.
function newEmail(): string {
  counter += 1;
  return `${PREFIX}${counter}@example.com`;
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Sara Ahmed',
    email: newEmail(),
    password: PASSWORD,
    acceptTerms: true,
    ...overrides,
  };
}

// The Set-Cookie headers of a response (none when the header is absent).
function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw)
    ? raw.filter((cookie): cookie is string => typeof cookie === 'string')
    : [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('POST /api/auth/register (e2e)', () => {
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
    // The unique email index must exist before the duplicate and race tests.
    await userModel.init();
  }, CONNECT_TIMEOUT_MS);

  // Deletes only this run's users, then closes the MongoDB connection.
  afterAll(async () => {
    await userModel.deleteMany({
      email: { $regex: `^${escapeRegExp(PREFIX)}` },
    });
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  function register(payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/auth/register')
      .send(payload);
  }

  describe('success', () => {
    it(
      'returns 201 with the profile and no password hash',
      async () => {
        const payload = body();
        const res = await register({
          ...payload,
          email: `  ${payload.email.toUpperCase()} `,
        }).expect(201);

        expect(res.body).toMatchObject({
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          name: 'Sara Ahmed',
          email: payload.email,
          role: 'USER',
          status: 'ACTIVE',
          mustChangePassword: false,
        });
        expect(res.body).not.toHaveProperty('passwordHash');
      },
      REQUEST_TIMEOUT_MS,
    );

    it(
      'logs the user in with the httpOnly access_token cookie, never a token in the body',
      async () => {
        const res = await register(body()).expect(201);

        const cookies = setCookies(res).filter((cookie) =>
          cookie.startsWith('access_token='),
        );
        expect(cookies).toHaveLength(1);
        const cookie = cookies[0];
        for (const attribute of [
          'HttpOnly',
          'Secure',
          'SameSite=Lax',
          'Path=/',
          'Max-Age=1800',
        ]) {
          expect(cookie.split('; ')).toContain(attribute);
        }

        const token = cookie.slice('access_token='.length).split(';')[0];
        expect(token.split('.')).toHaveLength(3);
        expect(JSON.stringify(res.body)).not.toContain(token);
        expect(Object.keys(res.body)).not.toEqual(
          expect.arrayContaining(['token']),
        );
      },
      REQUEST_TIMEOUT_MS,
    );

    it(
      'stores a bcrypt hash, never the plain password, and the terms timestamp',
      async () => {
        const payload = body();
        await register(payload).expect(201);

        const stored = await userModel
          .findOne({ email: payload.email })
          .select('+passwordHash')
          .lean<User>()
          .exec();
        expect(stored).not.toBeNull();
        expect(stored?.passwordHash.startsWith('$2b$')).toBe(true);
        expect(stored?.passwordHash).not.toBe(PASSWORD);
        expect(stored?.termsAcceptedAt).toBeInstanceOf(Date);
      },
      REQUEST_TIMEOUT_MS,
    );
  });

  describe('duplicate email', () => {
    it(
      'returns 409 EMAIL_ALREADY_REGISTERED for the same email in another case and with spaces',
      async () => {
        const payload = body();
        await register(payload).expect(201);

        const res = await register({
          ...payload,
          email: `  ${payload.email.toUpperCase()}  `,
        }).expect(409);
        expect(res.body).toMatchObject({
          statusCode: 409,
          code: 'EMAIL_ALREADY_REGISTERED',
        });
        expect(res.body.errors).toEqual([
          { field: 'email', messages: expect.any(Array) },
        ]);
        expect(setCookies(res)).toEqual([]);
      },
      REQUEST_TIMEOUT_MS * 2,
    );

    it(
      'lets exactly one of two parallel registrations win',
      async () => {
        const payload = body();
        const results = await Promise.all([
          register(payload),
          register(payload),
        ]);

        const statuses = results.map((res) => res.status).sort((a, b) => a - b);
        expect(statuses).toEqual([201, 409]);
        const loser = results.find((res) => res.status === 409);
        expect(loser && setCookies(loser)).toEqual([]);
        expect(await userModel.countDocuments({ email: payload.email })).toBe(
          1,
        );
      },
      REQUEST_TIMEOUT_MS * 2,
    );
  });

  describe('validation (400)', () => {
    async function expectFieldError(
      payload: Record<string, unknown>,
      field: string,
    ) {
      const res = await register(payload).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      // A failed registration never logs anyone in.
      expect(setCookies(res)).toEqual([]);
      const fields = (res.body.errors as { field: string }[]).map(
        (e) => e.field,
      );
      expect(fields).toContain(field);
      return res;
    }

    it('rejects a password without a digit with the specific message', async () => {
      const res = await expectFieldError(
        body({ password: 'abcdefgh' }),
        'password',
      );
      expect(res.body.errors).toContainEqual({
        field: 'password',
        messages: ['password must contain at least one digit'],
      });
    });

    it('rejects acceptTerms false', async () => {
      const res = await expectFieldError(
        body({ acceptTerms: false }),
        'acceptTerms',
      );
      expect(res.body.errors).toContainEqual({
        field: 'acceptTerms',
        messages: ['acceptTerms must be true to register'],
      });
    });

    it('rejects a missing acceptTerms', async () => {
      const payload: Record<string, unknown> = body();
      delete payload.acceptTerms;
      await expectFieldError(payload, 'acceptTerms');
    });

    it('rejects an invalid email', async () => {
      await expectFieldError(body({ email: 'not-an-email' }), 'email');
    });

    it('rejects a role field instead of ignoring it', async () => {
      const payload = body({ role: 'ADMIN' });
      await expectFieldError(payload, 'role');
      expect(await userModel.countDocuments({ email: payload.email })).toBe(0);
    });

    it('rejects a name of only spaces', async () => {
      await expectFieldError(body({ name: '    ' }), 'name');
    });
  });
});
