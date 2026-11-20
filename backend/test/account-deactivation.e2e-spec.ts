// ACC-12 end to end against the shared database.
//
// The "upcoming confirmed booking" branch cannot be reached through HTTP yet:
// no booking module provides a BookingsPort, so BookingsGateway reports no
// bookings. That branch is covered by the UsersService unit tests and by the
// gateway tests; this suite overrides the gateway to prove the endpoint itself
// returns 409 when a module does report one.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role, UserStatus } from './../src/common/auth/auth.enums';
import { UsersService } from './../src/auth/users/users.service';
import { BookingsGateway } from './../src/common/bookings/bookings.gateway';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;
const ME = '/api/users/me';

describe('Account deactivation (e2e)', () => {
  let app: INestApplication<App>;
  const createdUserIds: string[] = [];
  let hasUpcoming: jest.SpyInstance;

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

  beforeEach(() => {
    // Default: no booking module reports an upcoming booking, which is also
    // the real behaviour while neither port is wired in.
    hasUpcoming = jest
      .spyOn(app.get(BookingsGateway), 'hasUpcomingConfirmedBookings')
      .mockResolvedValue(false);
  });

  afterEach(() => {
    hasUpcoming.mockRestore();
  });

  describe('DELETE /api/users/me (ACC-12)', () => {
    it(
      'deactivates the account and ends its sessions',
      async () => {
        const user = await signIn({ label: 'deact' });

        const res = await request(app.getHttpServer())
          .delete(ME)
          .set('Cookie', user.cookie)
          .send({ confirm: true })
          .expect(200);

        expect(res.body).toMatchObject({
          id: user.userId,
          status: UserStatus.DEACTIVATED,
        });

        // The guard reloads the user on every request, so the cookie it already
        // holds stops working at once without any token being revoked.
        await request(app.getHttpServer())
          .get(ME)
          .set('Cookie', user.cookie)
          .expect(401);
      },
      SLOW_MS,
    );

    it(
      'keeps the account row, with the date it was deactivated',
      async () => {
        const user = await signIn({ label: 'deact-row' });

        await request(app.getHttpServer())
          .delete(ME)
          .set('Cookie', user.cookie)
          .send({ confirm: true })
          .expect(200);

        // Nothing is deleted: past bookings, payments and refunds still point
        // at a real account.
        const stored = await app.get(UsersService).findByIdOrThrow(user.userId);
        expect(stored.status).toBe(UserStatus.DEACTIVATED);
        expect(stored.deactivatedAt).toBeInstanceOf(Date);
        expect(stored.email).toBe(user.email);
      },
      SLOW_MS,
    );

    // ACC-12 says "after confirmation": the backend does not take an empty
    // DELETE as consent (GEN-03, GEN-13).
    it.each<[Record<string, unknown>, string]>([
      [{}, 'confirm missing'],
      [{ confirm: false }, 'confirm false'],
      [{ confirm: 'yes' }, 'confirm not a boolean'],
    ])(
      'refuses %o (%s) with a field error',
      async (body) => {
        const user = await signIn({ label: 'deact-confirm' });

        const res = await request(app.getHttpServer())
          .delete(ME)
          .set('Cookie', user.cookie)
          .send(body)
          .expect(400);

        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(res.body.errors[0].field).toBe('confirm');

        // Still active.
        await request(app.getHttpServer())
          .get(ME)
          .set('Cookie', user.cookie)
          .expect(200);
      },
      SLOW_MS,
    );

    it(
      'refuses while a booking module reports an upcoming booking (409)',
      async () => {
        const user = await signIn({ label: 'deact-blocked' });
        hasUpcoming.mockResolvedValue(true);

        const res = await request(app.getHttpServer())
          .delete(ME)
          .set('Cookie', user.cookie)
          .send({ confirm: true })
          .expect(409);

        expect(res.body.code).toBe('UPCOMING_BOOKINGS_EXIST');

        // The account is untouched and still usable.
        const still = await request(app.getHttpServer())
          .get(ME)
          .set('Cookie', user.cookie)
          .expect(200);
        expect(still.body.status).toBe(UserStatus.ACTIVE);
      },
      SLOW_MS,
    );

    it('refuses an anonymous request (401)', async () => {
      await request(app.getHttpServer())
        .delete(ME)
        .send({ confirm: true })
        .expect(401);
    });

    it(
      'can only ever deactivate the account in the cookie',
      async () => {
        const mine = await signIn({ label: 'deact-mine' });
        const other = await signIn({ label: 'deact-other' });

        await request(app.getHttpServer())
          .delete(ME)
          .set('Cookie', other.cookie)
          .send({ confirm: true })
          .expect(200);

        // There is no id in the route or the body, so nothing could point here.
        const stillMine = await request(app.getHttpServer())
          .get(ME)
          .set('Cookie', mine.cookie)
          .expect(200);
        expect(stillMine.body.status).toBe(UserStatus.ACTIVE);
      },
      SLOW_MS,
    );

    // An admin reactivating it is refused (ACC-16): it was the owner's call.
    it(
      'cannot be reactivated by an administrator',
      async () => {
        const user = await signIn({ label: 'deact-final' });
        const admin = await signIn({
          role: Role.ADMIN,
          label: 'deact-admin',
        });

        await request(app.getHttpServer())
          .delete(ME)
          .set('Cookie', user.cookie)
          .send({ confirm: true })
          .expect(200);

        const res = await request(app.getHttpServer())
          .patch(`/api/admin/accounts/${user.userId}/reactivate`)
          .set('Cookie', admin.cookie)
          .expect(400);

        expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
      },
      SLOW_MS,
    );
  });
});
