// ACC-07a, ACC-14, ACC-16 against the shared database.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role, UserStatus } from './../src/common/auth/auth.enums';
import { UsersService } from './../src/auth/users/users.service';
import {
  createSignedInUser,
  login,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 120_000;
// Each account in this suite is one bcrypt hash at 12 rounds.
const SLOW_MS = 60_000;
const ACCOUNTS = '/api/admin/accounts';

describe('Admin account administration (e2e)', () => {
  let app: INestApplication<App>;
  const createdUserIds: string[] = [];
  let admin: SignedInUser;
  let plainUser: SignedInUser;

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

    admin = await signIn({ role: Role.ADMIN, label: 'admin' });
    plainUser = await signIn({ label: 'plain' });
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  describe('role enforcement (ACC-11, GEN-13)', () => {
    it.each([
      ['get', ACCOUNTS],
      ['patch', `${ACCOUNTS}/6720f1c2a1b2c3d4e5f60718/suspend`],
      ['patch', `${ACCOUNTS}/6720f1c2a1b2c3d4e5f60718/reactivate`],
      ['post', '/api/admin/users/6720f1c2a1b2c3d4e5f60718/reset-password'],
    ])('%s %s rejects a non-admin account (403)', async (method, path) => {
      const res = await request(app.getHttpServer())
        [method as 'get' | 'patch' | 'post'](path)
        .set('Cookie', plainUser.cookie)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer()).get(ACCOUNTS).expect(401);
    });
  });

  describe('GET /api/admin/accounts (ACC-14)', () => {
    it('returns the documented row shape without credentials', async () => {
      const res = await request(app.getHttpServer())
        .get(`${ACCOUNTS}?search=${encodeURIComponent(plainUser.email)}`)
        .set('Cookie', admin.cookie)
        .expect(200);

      expect(res.body.meta.pageSize).toBe(10);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toEqual({
        id: plainUser.userId,
        name: 'C2 Test Account',
        email: plainUser.email,
        role: Role.USER,
        status: UserStatus.ACTIVE,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        mustChangePassword: false,
        suspendedAt: null,
        deactivatedAt: null,
      });
      for (const field of [
        'passwordHash',
        'failedLoginAttempts',
        'lockedUntil',
      ]) {
        expect(res.body.items[0]).not.toHaveProperty(field);
      }
    });

    it('searches the name as well as the email, case-insensitively', async () => {
      const res = await request(app.getHttpServer())
        .get(`${ACCOUNTS}?search=c2+tEsT+aCCount`)
        .set('Cookie', admin.cookie)
        .expect(200);

      expect(res.body.meta.totalItems).toBeGreaterThanOrEqual(2);
    });

    it('filters by role and by status', async () => {
      const byRole = await request(app.getHttpServer())
        .get(`${ACCOUNTS}?role=${Role.ADMIN}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(
        byRole.body.items.every(
          (row: { role: Role }) => row.role === Role.ADMIN,
        ),
      ).toBe(true);

      const byStatus = await request(app.getHttpServer())
        .get(`${ACCOUNTS}?status=${UserStatus.ACTIVE}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(
        byStatus.body.items.every(
          (row: { status: UserStatus }) => row.status === UserStatus.ACTIVE,
        ),
      ).toBe(true);
    });

    // The search term is escaped, so a regular expression is matched as text
    // and cannot be used to scan the collection or stall the server.
    it('treats a regular expression in search as literal text', async () => {
      const res = await request(app.getHttpServer())
        .get(`${ACCOUNTS}?search=${encodeURIComponent('.*')}`)
        .set('Cookie', admin.cookie)
        .expect(200);

      expect(res.body.meta.totalItems).toBe(0);
    });

    it.each([
      ['role=MODERATOR', 'role'],
      ['status=BANNED', 'status'],
      ['search=', 'search'],
      ['limit=50', 'limit'],
    ])('rejects %s with a field error', async (query, field) => {
      const res = await request(app.getHttpServer())
        .get(`${ACCOUNTS}?${query}`)
        .set('Cookie', admin.cookie)
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe(field);
    });
  });

  describe('suspend and reactivate (ACC-16)', () => {
    it(
      'suspends, ends the sessions, notifies, and reactivates',
      async () => {
        const target = await signIn({ label: 'suspendme' });

        const suspended = await request(app.getHttpServer())
          .patch(`${ACCOUNTS}/${target.userId}/suspend`)
          .set('Cookie', admin.cookie)
          .expect(200);

        expect(suspended.body.status).toBe(UserStatus.SUSPENDED);
        expect(suspended.body.suspendedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // The guard reloads the user every request, so the account's own cookie
        // stops working immediately.
        await request(app.getHttpServer())
          .get('/api/users/me')
          .set('Cookie', target.cookie)
          .expect(401);

        // Suspending again is accepted and changes nothing.
        const again = await request(app.getHttpServer())
          .patch(`${ACCOUNTS}/${target.userId}/suspend`)
          .set('Cookie', admin.cookie)
          .expect(200);
        expect(again.body.status).toBe(UserStatus.SUSPENDED);

        const reactivated = await request(app.getHttpServer())
          .patch(`${ACCOUNTS}/${target.userId}/reactivate`)
          .set('Cookie', admin.cookie)
          .expect(200);
        expect(reactivated.body.status).toBe(UserStatus.ACTIVE);
        expect(reactivated.body.suspendedAt).toBeNull();
      },
      SLOW_MS,
    );

    it(
      'tells the owner in the app (GEN-01)',
      async () => {
        const target = await signIn({ label: 'notified' });

        await request(app.getHttpServer())
          .patch(`${ACCOUNTS}/${target.userId}/suspend`)
          .set('Cookie', admin.cookie)
          .expect(200);
        await request(app.getHttpServer())
          .patch(`${ACCOUNTS}/${target.userId}/reactivate`)
          .set('Cookie', admin.cookie)
          .expect(200);

        // Reading the notifications needs a live session, which the suspension
        // revoked, so a fresh one is created for the same account.
        const fresh = await createSignedInUser(app, { label: 'notified-read' });
        createdUserIds.push(fresh.userId);

        const res = await request(app.getHttpServer())
          .get('/api/notifications')
          .set('Cookie', fresh.cookie)
          .expect(200);
        // The notice went to the suspended account, not to this one.
        expect(res.body.items).toEqual([]);
      },
      SLOW_MS,
    );

    it(
      'refuses to suspend another admin (403)',
      async () => {
        const otherAdmin = await signIn({ role: Role.ADMIN, label: 'admin2' });

        const res = await request(app.getHttpServer())
          .patch(`${ACCOUNTS}/${otherAdmin.userId}/suspend`)
          .set('Cookie', admin.cookie)
          .expect(403);

        expect(res.body.code).toBe('CANNOT_TARGET_ADMIN');
      },
      SLOW_MS,
    );

    it('refuses to suspend its own account (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${ACCOUNTS}/${admin.userId}/suspend`)
        .set('Cookie', admin.cookie)
        .expect(400);

      expect(res.body.code).toBe('CANNOT_TARGET_SELF');
    });

    it('answers 404 for an unknown or malformed id', async () => {
      await request(app.getHttpServer())
        .patch(`${ACCOUNTS}/${new Types.ObjectId().toString()}/suspend`)
        .set('Cookie', admin.cookie)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`${ACCOUNTS}/not-an-id/suspend`)
        .set('Cookie', admin.cookie)
        .expect(404);
    });
  });

  // ACC-05 + ACC-07a. The Leader asked whether an admin password reset should
  // also clear a running lock. It should: the admin has just given the account
  // a new password, so making the person wait out a lockout earned by the old
  // one helps nobody, and there is no other way to clear it from the API.
  describe('an admin reset clears an ACC-05 lockout', () => {
    it(
      'unlocks the account, and the temporary password logs in at once',
      async () => {
        const target = await signIn({ label: 'locked' });

        // Lock it: five wrong passwords.
        for (let i = 1; i < 5; i += 1) {
          await request(app.getHttpServer())
            .post('/api/auth/login')
            .send({ email: target.email, password: 'WrongPass123' })
            .expect(401);
        }
        const locked = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: target.email, password: 'WrongPass123' })
          .expect(423);
        expect(locked.body.code).toBe('ACCOUNT_LOCKED');

        // Even the right password is refused while the lock runs.
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: target.email, password: target.password })
          .expect(423);

        const reset = await request(app.getHttpServer())
          .post(`/api/admin/users/${target.userId}/reset-password`)
          .set('Cookie', admin.cookie)
          .expect(200);

        // The lock is gone: the temporary password logs in straight away.
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({
            email: target.email,
            password: reset.body.temporaryPassword as string,
          })
          .expect(200);
      },
      SLOW_MS,
    );
  });

  describe('POST /api/admin/users/:id/reset-password (ACC-07a)', () => {
    it(
      'issues a working temporary password that must then be changed',
      async () => {
        const target = await signIn({ label: 'reset' });
        const users = app.get(UsersService);

        const res = await request(app.getHttpServer())
          .post(`/api/admin/users/${target.userId}/reset-password`)
          .set('Cookie', admin.cookie)
          .expect(200);

        expect(res.body).toEqual({
          userId: target.userId,
          email: target.email,
          temporaryPassword: expect.stringMatching(/^Tmp[0-9a-f]{10}9$/),
          message: expect.stringContaining('cannot be shown again'),
        });

        // The temporary password really is the account's password now.
        const stored = await users.findByIdOrThrow(target.userId);
        expect(stored.mustChangePassword).toBe(true);
        // temporaryPasswordIssuedAt is internal and not part of UserProfile.

        // The cookie the account already held is dead: the reset revoked every
        // session of the account (ACC-06), so a device that was signed in before
        // the reset cannot keep using it. 401, not the 403 below - there is no
        // session left to tell that this user owes a password change.
        const dead = await request(app.getHttpServer())
          .get('/api/users/me')
          .set('Cookie', target.cookie)
          .expect(401);
        expect(dead.body.code).toBe('UNAUTHENTICATED');

        // The temporary password is what logs in now, and the old one does not.
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: target.email, password: target.password })
          .expect(401);
        const cookie = await login(
          app,
          target.email,
          res.body.temporaryPassword as string,
        );

        // That new session is allowed to exist, and is refused everything but
        // change-password until the account chooses its own (ACC-07a).
        const blocked = await request(app.getHttpServer())
          .get('/api/users/me')
          .set('Cookie', cookie)
          .expect(403);
        expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

        // Choosing a password is the way out, and then the API opens up.
        await request(app.getHttpServer())
          .patch('/api/auth/change-password')
          .set('Cookie', cookie)
          .send({
            currentPassword: res.body.temporaryPassword as string,
            newPassword: 'Chosen123',
          })
          .expect(200);

        await request(app.getHttpServer())
          .get('/api/users/me')
          .set('Cookie', cookie)
          .expect(200);
      },
      SLOW_MS,
    );

    it(
      'never returns the same temporary password twice',
      async () => {
        const target = await signIn({ label: 'reset2' });

        const first = await request(app.getHttpServer())
          .post(`/api/admin/users/${target.userId}/reset-password`)
          .set('Cookie', admin.cookie)
          .expect(200);
        const second = await request(app.getHttpServer())
          .post(`/api/admin/users/${target.userId}/reset-password`)
          .set('Cookie', admin.cookie)
          .expect(200);

        expect(first.body.temporaryPassword).not.toBe(
          second.body.temporaryPassword,
        );
      },
      SLOW_MS,
    );

    it(
      'refuses its own account and another admin',
      async () => {
        const otherAdmin = await signIn({ role: Role.ADMIN, label: 'admin3' });

        await request(app.getHttpServer())
          .post(`/api/admin/users/${admin.userId}/reset-password`)
          .set('Cookie', admin.cookie)
          .expect(400);

        await request(app.getHttpServer())
          .post(`/api/admin/users/${otherAdmin.userId}/reset-password`)
          .set('Cookie', admin.cookie)
          .expect(403);
      },
      SLOW_MS,
    );
  });
});
