// Runs against the shared database. Every account it creates has a test_c2_
// email and is deleted again in afterAll.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from './../src/auth/auth.constants';
import { AuthTokensService } from './../src/auth/auth-tokens.service';
import { Role } from './../src/auth/enums/role.enum';
import { UserStatus } from './../src/auth/enums/user-status.enum';
import { User } from './../src/auth/schemas/user.schema';
import { SessionsService } from './../src/auth/sessions.service';
import { UsersService } from './../src/auth/users.service';
import {
  cookieForUnknownSession,
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 30_000;
// Each account costs one bcrypt hash at 12 rounds.
const SLOW_MS = 30_000;

const CHANGE_PASSWORD = '/api/auth/change-password';

describe('Authentication and account core (e2e)', () => {
  let app: INestApplication<App>;
  const createdUserIds: string[] = [];

  async function signIn(
    options: Parameters<typeof createSignedInUser>[1] = {},
  ): Promise<SignedInUser> {
    const user = await createSignedInUser(app, options);
    createdUserIds.push(user.userId);
    return user;
  }

  /** Sets the status without the session revocation that setStatus performs. */
  async function setStatusKeepingSession(
    userId: string,
    status: UserStatus,
  ): Promise<void> {
    const userModel = app.get<Model<User>>(getModelToken(User.name));
    await userModel
      .updateOne({ _id: new Types.ObjectId(userId) }, { $set: { status } })
      .exec();
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

  describe('AuthenticatedGuard', () => {
    it('rejects a request with no cookie (401)', async () => {
      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .send({ currentPassword: 'TestPass123', newPassword: 'NewPass123' })
        .expect(401);

      expect(res.body).toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        path: CHANGE_PASSWORD,
      });
      expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('rejects a malformed token (401 INVALID_TOKEN)', async () => {
      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', `${ACCESS_TOKEN_COOKIE}=not.a.jwt`)
        .send({ currentPassword: 'TestPass123', newPassword: 'NewPass123' })
        .expect(401);

      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    // ACC-06: a token whose session is gone (logged out, revoked, or 30 minutes
    // idle) is refused even though the JWT itself is still valid.
    it('rejects a valid token whose session does not exist (401 SESSION_EXPIRED)', async () => {
      const user = await signIn();
      const cookie = await cookieForUnknownSession(app, user.userId);

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', cookie)
        .send({ currentPassword: user.password, newPassword: 'NewPass123' })
        .expect(401);

      expect(res.body.code).toBe('SESSION_EXPIRED');
    }, SLOW_MS);

    it('rejects a revoked session (401 SESSION_EXPIRED)', async () => {
      const user = await signIn();
      await app.get(SessionsService).revoke(user.sessionId);

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'NewPass123' })
        .expect(401);

      expect(res.body.code).toBe('SESSION_EXPIRED');
    }, SLOW_MS);

    // ACC-16 going through setStatus revokes the sessions as well, so the
    // request would stop at SESSION_EXPIRED. Writing the status straight to the
    // document leaves the session alive and proves the guard's own status check
    // is what refuses the request.
    it('rejects a suspended account whose session is still live (403)', async () => {
      const user = await signIn({ label: 'suspended' });
      await setStatusKeepingSession(user.userId, UserStatus.SUSPENDED);

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'NewPass123' })
        .expect(403);

      expect(res.body).toMatchObject({
        statusCode: 403,
        code: 'ACCOUNT_SUSPENDED',
        message: 'Account suspended',
      });
    }, SLOW_MS);

    it('rejects a deactivated account whose session is still live (403)', async () => {
      const user = await signIn({ label: 'deactivated' });
      await setStatusKeepingSession(user.userId, UserStatus.DEACTIVATED);

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'NewPass123' })
        .expect(403);

      expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
    }, SLOW_MS);
  });

  describe('PATCH /api/auth/change-password (ACC-08)', () => {
    it('changes the password and keeps this session signed in', async () => {
      const user = await signIn({ label: 'change' });

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'BrandNew123' })
        .expect(200);

      expect(res.body).toEqual({ message: 'Password changed' });

      // The new password is in effect: changing again from the old one fails.
      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'Another123' })
        .expect(401);

      // ...and from the new one it works, which also proves the caller's own
      // session survived the revoke-all.
      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: 'BrandNew123', newPassword: 'Another123' })
        .expect(200);
    }, SLOW_MS);

    it('signs the account out of its other sessions but not this one', async () => {
      const user = await signIn({ label: 'multi' });
      const sessions = app.get(SessionsService);
      const tokens = app.get(AuthTokensService);
      // A second login of the same account, as if from another device.
      const refreshToken = tokens.generateRefreshToken();
      const otherSession = await sessions.create(
        new Types.ObjectId(user.userId),
        tokens.hashRefreshToken(refreshToken),
      );

      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'BrandNew123' })
        .expect(200);

      // The other device has to log in again; this one stays signed in.
      await expect(
        sessions.touchIfUsable(otherSession._id.toString()),
      ).resolves.toBeNull();
      await expect(
        sessions.touchIfUsable(user.sessionId),
      ).resolves.not.toBeNull();
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

    // GEN-02: field-level messages for every broken rule.
    it.each([
      ['Short1', 'too short'],
      ['nodigitshere', 'no digit'],
      ['123456789', 'no letter'],
    ])('rejects the new password %s (%s) with a field error', async (newPassword) => {
      const user = await signIn({ label: 'policy' });

      const res = await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors).toEqual([
        {
          field: 'newPassword',
          messages: [expect.stringContaining('at least 8 characters')],
        },
      ]);
    }, SLOW_MS);

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

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe('role');
    }, SLOW_MS);

    // ACC-07a: an account on a temporary password can reach this route and
    // nothing else; the change clears the flag.
    it('is the one route open to an account that owes a password change', async () => {
      const user = await signIn({
        label: 'temp',
        mustChangePassword: true,
      });

      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', user.cookie)
        .send({ currentPassword: user.password, newPassword: 'Chosen123' })
        .expect(200);

      const refreshed = await app.get(UsersService).findByIdOrThrow(user.userId);
      expect(refreshed.mustChangePassword).toBe(false);
      expect(refreshed.temporaryPasswordIssuedAt).toBeNull();
    }, SLOW_MS);
  });

  describe('stored data (GEN-13, ACC-19)', () => {
    it('never returns or stores the password in plain text', async () => {
      const user = await signIn({ label: 'storage' });
      const stored = await app.get(UsersService).findByIdOrThrow(user.userId);

      // passwordHash has select: false, so a normal read cannot even see it.
      expect(
        (stored as unknown as { passwordHash?: string }).passwordHash,
      ).toBeUndefined();

      const withHash = await app
        .get(UsersService)
        .findByEmailWithPassword(user.email);
      expect(withHash?.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(withHash?.passwordHash).not.toContain(user.password);
    }, SLOW_MS);

    it('stores the email lowercase so one address is one account', async () => {
      const user = await signIn({ label: 'Email' });
      const stored = await app.get(UsersService).findByIdOrThrow(user.userId);

      expect(stored.email).toBe(user.email.toLowerCase());
      expect(stored.role).toBe(Role.USER);
      expect(stored.status).toBe(UserStatus.ACTIVE);
      expect(stored.termsVersion).toBe('1.0');
    }, SLOW_MS);
  });
});
