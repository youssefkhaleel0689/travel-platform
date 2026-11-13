// GET and PATCH /api/users/me against the shared database (ACC-09, ACC-11).
// Needs the seeded currencies: run `npm run seed` first.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role, UserStatus } from './../src/common/auth/auth.enums';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 90_000;
const SLOW_MS = 30_000;
const ME = '/api/users/me';

describe('Own profile (e2e)', () => {
  let app: INestApplication<App>;
  const createdUserIds: string[] = [];
  let user: SignedInUser;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    user = await createSignedInUser(app, { label: 'profile' });
    createdUserIds.push(user.userId);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  describe('GET /api/users/me (ACC-11)', () => {
    it('returns the profile of the account behind the cookie', async () => {
      const res = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(200);

      expect(res.body).toEqual({
        id: user.userId,
        name: 'C2 Test Account',
        email: user.email,
        phone: null,
        preferredCurrency: null,
        role: Role.USER,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    // GEN-13: no credential or login-security field may ever reach a client.
    it('never returns credentials or login-security fields', async () => {
      const res = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(200);

      for (const field of [
        'passwordHash',
        'password',
        'failedLoginAttempts',
        'lockedUntil',
        'temporaryPasswordIssuedAt',
        '_id',
        '__v',
      ]) {
        expect(res.body).not.toHaveProperty(field);
      }
    });

    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer()).get(ME).expect(401);
    });
  });

  describe('PATCH /api/users/me (ACC-09)', () => {
    it('updates the three editable fields and returns the new profile', async () => {
      const res = await request(app.getHttpServer())
        .patch(ME)
        .set('Cookie', user.cookie)
        .send({
          name: '  Taher Khalaf  ',
          phone: '+20 (123) 456-7890',
          preferredCurrency: 'egp',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id: user.userId,
        name: 'Taher Khalaf',
        phone: '+201234567890',
        preferredCurrency: 'EGP',
        email: user.email,
      });

      // The change was persisted, not only echoed back.
      const reread = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(reread.body.name).toBe('Taher Khalaf');
      expect(reread.body.preferredCurrency).toBe('EGP');
    });

    it('leaves out fields that were not sent', async () => {
      await request(app.getHttpServer())
        .patch(ME)
        .set('Cookie', user.cookie)
        .send({ name: 'Only The Name' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body.name).toBe('Only The Name');
      expect(res.body.phone).toBe('+201234567890');
      expect(res.body.preferredCurrency).toBe('EGP');
    });

    it('clears the phone and the currency with null', async () => {
      const res = await request(app.getHttpServer())
        .patch(ME)
        .set('Cookie', user.cookie)
        .send({ phone: null, preferredCurrency: null })
        .expect(200);

      expect(res.body.phone).toBeNull();
      expect(res.body.preferredCurrency).toBeNull();
    });

    // GEN-12: the currency has to exist in the seeded list, not just look right.
    it('rejects a well-formed but unseeded currency (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch(ME)
        .set('Cookie', user.cookie)
        .send({ preferredCurrency: 'XYZ' })
        .expect(400);

      expect(res.body.code).toBe('UNSUPPORTED_CURRENCY');
    });

    // GEN-02: one entry per invalid field, with the field name.
    it('reports a field-level error for every invalid field (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch(ME)
        .set('Cookie', user.cookie)
        .send({ name: '', phone: '123', preferredCurrency: 'EG' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(
        ['name', 'phone', 'preferredCurrency'],
      );
    });

    it.each(['email', 'role', 'status', 'passwordHash', 'mustChangePassword'])(
      'refuses to accept %s in the body (400)',
      async (field) => {
        const res = await request(app.getHttpServer())
          .patch(ME)
          .set('Cookie', user.cookie)
          .send({ [field]: 'ADMIN' })
          .expect(400);

        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(res.body.errors[0].field).toBe(field);
      },
    );

    it('cannot be used to edit another account', async () => {
      const other = await createSignedInUser(app, { label: 'other' });
      createdUserIds.push(other.userId);

      // There is no id in the route or the body to point elsewhere: the only
      // account this endpoint can touch is the one in the cookie.
      await request(app.getHttpServer())
        .patch(ME)
        .set('Cookie', other.cookie)
        .send({ name: 'Changed By Other' })
        .expect(200);

      const mine = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(mine.body.name).toBe('Only The Name');
    }, SLOW_MS);

    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer())
        .patch(ME)
        .send({ name: 'Anonymous' })
        .expect(401);
    });
  });
});
