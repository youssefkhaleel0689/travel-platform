// The ACC-18 admin seed against the real app and database. The seeder gets its admin
// credentials from a config stub (never from .env here). Every user this test creates has an
// email starting with a prefix unique to the run, and afterAll deletes exactly those.
import { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { User } from './../src/auth/schemas/user.schema';
import { AdminSeeder } from './../src/auth/seed/admin-seeder.service';
import { UsersService } from './../src/auth/users/users.service';
import { Role } from './../src/common/auth/auth.enums';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 90_000;
// Seeding, register and login compute real bcrypt hashes at the configured cost.
const REQUEST_TIMEOUT_MS = 15_000;

const PREFIX = `e2e-admin-seed-${Date.now()}-`;
const ADMIN_EMAIL = `${PREFIX}admin@example.com`;
// Test-only credentials, used only against this run's own accounts.
const ADMIN_PASSWORD = 'SeedAdmin2026';
const USER_EMAIL = `${PREFIX}user@example.com`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A ConfigService that only knows the given values.
function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
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

describe('Admin seed (e2e, ACC-18)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let seeder: AdminSeeder;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    userModel = app.get<Model<User>>(getModelToken(User.name));
    // The unique email index must exist before users are created.
    await userModel.init();

    // The app's real UsersService; only the credentials come from the stub.
    seeder = new AdminSeeder(
      configWith({
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
        ADMIN_NAME: 'E2E Admin',
      }),
      app.get(UsersService),
    );
  }, CONNECT_TIMEOUT_MS);

  // Deletes only this run's users, then closes the MongoDB connection.
  afterAll(async () => {
    await userModel.deleteMany({
      email: { $regex: `^${escapeRegExp(PREFIX)}` },
    });
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  function storedHash(email: string): Promise<User | null> {
    return userModel
      .findOne({ email })
      .select('+passwordHash')
      .lean<User>()
      .exec();
  }

  it(
    'creates the admin on the first run, with a bcrypt hash',
    async () => {
      await expect(seeder.seed()).resolves.toBe('created');

      const stored = await storedHash(ADMIN_EMAIL);
      expect(stored?.role).toBe(Role.ADMIN);
      expect(stored?.name).toBe('E2E Admin');
      expect(stored?.mustChangePassword).toBe(false);
      expect(stored?.termsAcceptedAt).toBeNull();
      expect(stored?.passwordHash.startsWith('$2b$')).toBe(true);
      expect(stored?.passwordHash).not.toBe(ADMIN_PASSWORD);
    },
    REQUEST_TIMEOUT_MS,
  );

  it('changes nothing on a second run, not even the hash', async () => {
    const before = await storedHash(ADMIN_EMAIL);
    await expect(seeder.seed()).resolves.toBe('already-exists');
    const after = await storedHash(ADMIN_EMAIL);

    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(await userModel.countDocuments({ email: ADMIN_EMAIL })).toBe(1);
  });

  it(
    'lets the seeded admin log in and see the ADMIN role on /api/auth/me',
    async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(200);
      expect(login.body.role).toBe('ADMIN');

      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', accessTokenCookie(login))
        .expect(200);
      expect(me.body).toMatchObject({ email: ADMIN_EMAIL, role: 'ADMIN' });
    },
    REQUEST_TIMEOUT_MS,
  );

  it(
    'refuses to promote a registered USER and leaves the account as it was',
    async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          name: 'Plain User',
          email: USER_EMAIL,
          password: 'Travel2026',
          acceptTerms: true,
        })
        .expect(201);

      const promoter = new AdminSeeder(
        configWith({ ADMIN_EMAIL: USER_EMAIL, ADMIN_PASSWORD }),
        app.get(UsersService),
      );
      await expect(promoter.seed()).rejects.toThrow('will not be promoted');

      const stored = await userModel
        .findOne({ email: USER_EMAIL })
        .lean<User>();
      expect(stored?.role).toBe(Role.USER);
    },
    REQUEST_TIMEOUT_MS,
  );
});
