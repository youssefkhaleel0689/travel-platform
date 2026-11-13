// ACC-08 (change password) and the ACC-07a enforcement, against the shared
// database. Accounts are registered and logged in through the real endpoints.
//
// Login, the cookie and the guard itself belong to ACC-04 and are covered by
// test/auth-guard.e2e-spec.ts. Session expiry and logout (ACC-06) are not built
// yet, so there are no tests for them here.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role, UserStatus } from './../src/common/auth/auth.enums';
import { UsersService } from './../src/auth/users/users.service';
import {
  createSignedInUser,
  deleteTestUsers,
  login,
  SignedInUser,
  TEST_PASSWORD,
} from './support/auth-test-helper';

// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 120_000;
// Each account costs at least one bcrypt hash.
const SLOW_MS = 60_000;

const CHANGE_PASSWORD = '/api/auth/change-password';
const ME = '/api/users/me';

describe('Change password and temporary passwords (e2e)', () => {
  let app: INestApplication<App>;
  const createdUserIds: string[] = [];

  async function signIn(
    options: Parameters<typeof createSignedInUser>[1] = {},
  ): Promise<SignedInUser> {
    const user = await createSignedInUser(app, options);
    createdUserIds.push(user.userId);
    return user;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  describe('PATCH /api/auth/change-password (ACC-08)', () => {
    it('changes the password, and the new one works for login', async () => {
      const user = await signIn({ label: 'change' });

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'BrandNew123' })
        .expect(200);

      expect(res.body).toEqual({ message: 'Password changed' });

      // The old password no longer logs in, the new one does.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(401);
      await expect(
        login(app, user.email, 'BrandNew123'),
      ).resolves.toContain('access_token=');
    }, SLOW_MS);

    it('leaves the caller logged in', async () => {
      const user = await signIn({ label: 'stays' });

      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'BrandNew123' })
        .expect(200);

      // The token is stateless, so the cookie keeps working. Revoking the
      // account's other devices needs sessions (ACC-06).
      await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(200);
    }, SLOW_MS);

    it('rejects a wrong current password (401 INVALID_CURRENT_PASSWORD)', async () => {
      const user = await signIn({ label: 'wrong' });

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: 'WrongPass123', newPassword: 'NewPass123' })
        .expect(401);

      expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
    }, SLOW_MS);

    it('rejects reusing the current password (400 PASSWORD_UNCHANGED)', async () => {
      const user = await signIn({ label: 'same' });

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: user.password })
        .expect(400);

      expect(res.body.code).toBe('PASSWORD_UNCHANGED');
    }, SLOW_MS);

    // The same shared rules as registration (ACC-01), so the two cannot drift.
    it.each([
      ['Short1', 'too short'],
      ['nodigitshere', 'no digit'],
      ['123456789', 'no letter'],
    ])(
      'rejects the new password %s (%s) with a field error',
      async (newPassword) => {
        const user = await signIn({ label: 'policy' });

        const res = await request(app.getHttpServer())
          .patch(CHANGE_PASSWORD)
          .set('Cookie', user.cookie)
          .send({ currentPassword: user.password, newPassword })
          .expect(400);

        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(res.body.errors[0].field).toBe('newPassword');
      },
      SLOW_MS,
    );

    it('rejects a body with an unknown field', async () => {
      const user = await signIn({ label: 'extra' });

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({
          currentPassword: user.password,
          newPassword: 'NewPass123',
          role: 'ADMIN',
        })
        .expect(400);

      expect(res.body.errors[0].field).toBe('role');
    }, SLOW_MS);

    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPass123' })
        .expect(401);
    });
  });

  // ACC-07a: the flag is only worth storing if it is enforced, and the guard is
  // where that happens.
  describe('an account on a temporary password', () => {
    it('can reach change-password and nothing else', async () => {
      const user = await signIn({
        label: 'temp',
        mustChangePassword: true,
      });

      const blocked = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'Chosen123' })
        .expect(200);

      // Choosing a password clears the flag, so the rest of the API opens up.
      await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(200);

      const profile = await app.get(UsersService).findByIdOrThrow(user.userId);
      expect(profile.mustChangePassword).toBe(false);
    }, SLOW_MS);
  });

  describe('stored data (GEN-13)', () => {
    it('never returns the password, and stores only a bcrypt hash', async () => {
      const user = await signIn({ label: 'storage' });

      const res = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(200);

      for (const field of [
        'passwordHash',
        'password',
        'failedLoginAttempts',
        'lockedUntil',
      ]) {
        expect(res.body).not.toHaveProperty(field);
      }
      expect(res.body.email).toBe(user.email.toLowerCase());
      expect(res.body.role).toBe(Role.USER);
      expect(res.body.status).toBe(UserStatus.ACTIVE);
    }, SLOW_MS);
  });
});
