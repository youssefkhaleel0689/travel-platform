// ACC-13 end to end against the shared database: an admin creates an airline
// or hotel moderator linked to exactly one provider, with a temporary password
// the moderator must replace at first login.
//
// A real airline is created for the suite (FLT-01, A2's endpoint) and removed
// again in afterAll, together with every account and every assignment row the
// suite wrote.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role, UserStatus } from './../src/common/auth/auth.enums';
import { AirlineModeratorAssignment } from './../src/flights/schemas/airline-moderator-assignment.schema';
import { Airline, AirlineStatus } from './../src/flights/schemas/airline.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  login,
  SignedInUser,
  testEmail,
} from './support/auth-test-helper';

// beforeAll does more than any other suite's: a Nest app against the shared
// Atlas cluster, two accounts registered and logged in over HTTP with a bcrypt
// hash each, and an airline created through the real FLT-01 endpoint. Suites run
// one at a time (--runInBand), so this one starts after a queue of twenty others
// and the cluster is at its slowest by then. 120s was not enough on a full run
// even though the suite finishes in about 30s on its own; do not lower this.
const CONNECT_TIMEOUT_MS = 180_000;
// Every created moderator costs at least one bcrypt hash.
const SLOW_MS = 60_000;

const MODERATORS = '/api/admin/moderators';
const ME = '/api/users/me';
const CHANGE_PASSWORD = '/api/auth/change-password';
const ADMIN_PASSWORD = 'AdminPass123';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomIataCode(): string {
  const pick = (): string =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return `${pick()}${pick()}`;
}

describe('Admin creates a moderator (ACC-13) (e2e)', () => {
  let app: INestApplication<App>;
  let airlineModel: Model<Airline>;
  let assignmentModel: Model<AirlineModeratorAssignment>;

  let admin: SignedInUser;
  let plainUser: SignedInUser;
  /** The airline every happy-path moderator is linked to. */
  let airlineId: string;
  /** Made on demand by deactivatedAirline(); only one test needs it. */
  let deactivatedAirlineId: string | undefined;

  const createdUserIds: string[] = [];
  const createdAirlineIds: string[] = [];

  /**
   * Creates an airline through the real FLT-01 endpoint. The IATA code is two
   * characters and unique across the whole collection, which the whole team
   * shares, so a collision is retried rather than failing the suite.
   */
  async function createAirline(label: string): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/airlines')
        .set('Cookie', admin.cookie)
        .send({ name: `test_c2_${label}`, iataCode: randomIataCode() });
      if (response.status === 201) {
        const id = response.body.id as string;
        createdAirlineIds.push(id);
        return id;
      }
      if (response.status !== 409) {
        throw new Error(
          `Could not create the test airline: ${response.status} ` +
            JSON.stringify(response.body),
        );
      }
    }
    throw new Error('Could not find a free IATA code for the test airline');
  }

  /**
   * A deactivated airline, made on first use rather than in beforeAll.
   *
   * Only one test needs it, and beforeAll already does more setup than any
   * other suite in the project (a Nest app against Atlas, two accounts over
   * HTTP with a bcrypt hash each, and an airline). Running one airline fewer
   * in the hook is what keeps it inside its timeout when this suite starts at
   * the back of a --runInBand queue.
   */
  async function deactivatedAirline(): Promise<string> {
    if (deactivatedAirlineId) {
      return deactivatedAirlineId;
    }
    const id = await createAirline('acc13-dead-airline');
    // ACC-15 (deactivate a provider) is not built yet, so the status is set
    // directly for this one case.
    await airlineModel
      .updateOne(
        { _id: new Types.ObjectId(id) },
        {
          $set: {
            status: AirlineStatus.DEACTIVATED,
            deactivatedAt: new Date(),
          },
        },
      )
      .exec();
    deactivatedAirlineId = id;
    return id;
  }

  /**
   * The body ACC-13 expects, with a fresh email every time.
   *
   * The provider id follows the role, because the DTO requires the one that
   * matches it and rejects the other: airlineId for an airline moderator,
   * hotelId for a hotel one. A hotel body gets an id that exists nowhere,
   * which is harmless while the hotels module is unwired - the 501 is raised
   * before any hotel is looked up.
   */
  function body(overrides: Record<string, unknown> = {}) {
    const role = overrides.role ?? Role.AIRLINE_MODERATOR;
    return {
      name: 'Omar Fathy',
      email: testEmail('mod'),
      role,
      ...(role === Role.HOTEL_MODERATOR
        ? { hotelId: new Types.ObjectId().toString() }
        : { airlineId }),
      ...overrides,
    };
  }

  /** The field names a 400 VALIDATION_FAILED body complains about. */
  function fieldsOf(responseBody: unknown): string[] {
    const errors = (responseBody as { errors?: { field: string }[] }).errors;
    return (errors ?? []).map((error) => error.field);
  }

  /** POSTs a moderator and remembers the account for cleanup. */
  async function createModerator(
    overrides: Record<string, unknown> = {},
    cookie = admin.cookie,
  ) {
    const response = await request(app.getHttpServer())
      .post(MODERATORS)
      .set('Cookie', cookie)
      .send(body(overrides));
    const id = response.body?.account?.id as string | undefined;
    if (id) {
      createdUserIds.push(id);
    }
    return response;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    airlineModel = app.get<Model<Airline>>(getModelToken(Airline.name));
    assignmentModel = app.get<Model<AirlineModeratorAssignment>>(
      getModelToken(AirlineModeratorAssignment.name),
    );

    admin = await createSignedInUser(app, {
      label: 'mod-admin',
      role: Role.ADMIN,
      password: ADMIN_PASSWORD,
    });
    plainUser = await createSignedInUser(app, { label: 'mod-notadmin' });
    createdUserIds.push(admin.userId, plainUser.userId);

    airlineId = await createAirline('acc13-airline');
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await assignmentModel
        .deleteMany({
          moderatorId: {
            $in: createdUserIds.map((id) => new Types.ObjectId(id)),
          },
        })
        .exec();
    }
    if (createdAirlineIds.length > 0) {
      await airlineModel
        .deleteMany({
          _id: { $in: createdAirlineIds.map((id) => new Types.ObjectId(id)) },
          // The name guard makes certain this never deletes a teammate's data.
          name: { $regex: '^test_c2_' },
        })
        .exec();
    }
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  describe('POST /api/admin/moderators', () => {
    it('creates the account, links it to the airline, and returns the password once', async () => {
      const res = await createModerator({ password: 'Welcome2026' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        account: {
          id: expect.stringMatching(/^[a-f\d]{24}$/),
          name: 'Omar Fathy',
          email: expect.stringContaining('test_c2_mod'),
          role: Role.AIRLINE_MODERATOR,
          status: UserStatus.ACTIVE,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          mustChangePassword: true,
          suspendedAt: null,
          deactivatedAt: null,
        },
        providerId: airlineId,
        temporaryPassword: 'Welcome2026',
        message: expect.stringContaining('cannot be shown again'),
      });

      // Exactly one link, in the collection the flights module owns.
      const links = await assignmentModel
        .find({ moderatorId: new Types.ObjectId(res.body.account.id) })
        .lean()
        .exec();
      expect(links).toHaveLength(1);
      expect(links[0].airlineId.toString()).toBe(airlineId);
    }, SLOW_MS);

    it('generates a temporary password when the admin sends none', async () => {
      const res = await createModerator();

      expect(res.status).toBe(201);
      expect(typeof res.body.temporaryPassword).toBe('string');
      expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(8);
      // It works, which is the only thing that matters about a generated one.
      await expect(
        login(app, res.body.account.email, res.body.temporaryPassword),
      ).resolves.toContain('access_token=');
    }, SLOW_MS);

    // The point of the requirement: the moderator must change the password
    // before it can do anything (ACC-07a enforcement in JwtAuthGuard).
    it('leaves the moderator able to do nothing until it sets its own password', async () => {
      const created = await createModerator({ password: 'Welcome2026' });
      expect(created.status).toBe(201);

      const cookie = await login(
        app,
        created.body.account.email,
        'Welcome2026',
      );

      const blocked = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', cookie)
        .expect(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', cookie)
        .send({ currentPassword: 'Welcome2026', newPassword: 'Chosen2026' })
        .expect(200);

      const profile = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', cookie)
        .expect(200);
      expect(profile.body.role).toBe(Role.AIRLINE_MODERATOR);
      expect(profile.body.mustChangePassword).toBe(false);
    }, SLOW_MS);

    // The unique index is on moderatorId, not airlineId: one airline may have
    // several moderators, but a moderator manages exactly one airline.
    it('allows a second moderator for the same airline', async () => {
      const first = await createModerator();
      const second = await createModerator();

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.providerId).toBe(airlineId);
    }, SLOW_MS);

    it('rejects an email that is already registered (409)', async () => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ email: plainUser.email }))
        .expect(409);

      expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    }, SLOW_MS);

    it('answers 404 for an airline that does not exist', async () => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ airlineId: new Types.ObjectId().toString() }))
        .expect(404);

      expect(res.body.code).toBe('AIRLINE_NOT_FOUND');
    }, SLOW_MS);

    // ACC-15: a deactivated provider gets no new moderator.
    it('answers 400 PROVIDER_DEACTIVATED for a deactivated airline', async () => {
      // Resolved before the request is built, never inside .send(): supertest
      // binds to an ephemeral listener as soon as request() is called, and a
      // second supertest call awaited inside the argument list closes the
      // listener the outer one is holding.
      const deactivatedId = await deactivatedAirline();

      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ airlineId: deactivatedId }))
        .expect(400);

      expect(res.body.code).toBe('PROVIDER_DEACTIVATED');
    }, SLOW_MS);

    // The provider is checked before anything is written, so a bad request
    // leaves no account behind and the email can be reused.
    it('creates no account when the provider is unusable', async () => {
      const email = testEmail('mod-orphan');

      await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ email, airlineId: new Types.ObjectId().toString() }))
        .expect(404);

      // Nothing was created, so the same email still works.
      const retry = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ email }))
        .expect(201);
      createdUserIds.push(retry.body.account.id as string);
    }, SLOW_MS);

    // The hotels module (B1, HTL-01) does not exist yet.
    it('answers 501 PROVIDER_TYPE_UNAVAILABLE for a hotel moderator', async () => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ role: Role.HOTEL_MODERATOR }))
        .expect(501);

      expect(res.body.code).toBe('PROVIDER_TYPE_UNAVAILABLE');
      expect(res.body.message).toContain('hotels module');
    }, SLOW_MS);
  });

  describe('validation', () => {
    it.each([Role.USER, Role.ADMIN, 'MODERATOR', ''])(
      'rejects role %s with a field error',
      async (role) => {
        const res = await request(app.getHttpServer())
          .post(MODERATORS)
          .set('Cookie', admin.cookie)
          .send(body({ role }))
          .expect(400);

        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(res.body.errors[0].field).toBe('role');
      },
      SLOW_MS,
    );

    it.each(['not-an-id', '123', ''])(
      'rejects airlineId %s with a field error',
      async (airlineIdValue) => {
        const res = await request(app.getHttpServer())
          .post(MODERATORS)
          .set('Cookie', admin.cookie)
          .send(body({ airlineId: airlineIdValue }))
          .expect(400);

        expect(res.body.errors[0].field).toBe('airlineId');
      },
      SLOW_MS,
    );

    // The role decides which provider id the body carries. The generic
    // providerId the endpoint used to take is now an unknown field, and the id
    // belonging to the other kind of provider is refused by name, so a body
    // meant for a hotel cannot quietly create an airline moderator.
    it('rejects the providerId the endpoint used to take', async () => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send({
          name: 'Omar Fathy',
          email: testEmail('mod'),
          role: Role.AIRLINE_MODERATOR,
          providerId: airlineId,
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(res.body)).toContain('providerId');
    }, SLOW_MS);

    it('rejects hotelId on an airline moderator', async () => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ hotelId: new Types.ObjectId().toString() }))
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe('hotelId');
      expect(res.body.errors[0].messages[0]).toContain('HOTEL_MODERATOR');
    }, SLOW_MS);

    it('rejects airlineId on a hotel moderator', async () => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ role: Role.HOTEL_MODERATOR, airlineId }))
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe('airlineId');
    }, SLOW_MS);

    it.each([Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
      'rejects %s with no provider id at all',
      async (role) => {
        const res = await request(app.getHttpServer())
          .post(MODERATORS)
          .set('Cookie', admin.cookie)
          .send({ name: 'Omar Fathy', email: testEmail('mod'), role })
          .expect(400);

        expect(fieldsOf(res.body)).toEqual([
          role === Role.AIRLINE_MODERATOR ? 'airlineId' : 'hotelId',
        ]);
      },
      SLOW_MS,
    );

    // The same shared rules as registration (ACC-01), so the two cannot drift.
    it.each([
      ['Short1', 'too short'],
      ['nodigitshere', 'no digit'],
      ['123456789', 'no letter'],
    ])('rejects the password %s (%s)', async (password) => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ password }))
        .expect(400);

      expect(res.body.errors[0].field).toBe('password');
    }, SLOW_MS);

    // "Optional" means "may be left out", not "may be null": a sent null is a
    // mistake in the admin's body, not a request to generate a password.
    it('rejects password: null rather than generating one', async () => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send(body({ password: null }))
        .expect(400);

      expect(res.body.errors[0].field).toBe('password');
    }, SLOW_MS);

    it('rejects a missing name and a bad email', async () => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', admin.cookie)
        .send({
          email: 'not-an-email',
          role: Role.AIRLINE_MODERATOR,
          airlineId,
        })
        .expect(400);

      const fields = (res.body.errors as { field: string }[]).map(
        (error) => error.field,
      );
      expect(fields).toContain('name');
      expect(fields).toContain('email');
    }, SLOW_MS);

    // No route may mint an account with a status or a flag chosen by the client.
    it.each(['status', 'mustChangePassword', 'temporaryPasswordIssuedAt'])(
      'rejects the unknown field %s',
      async (field) => {
        const res = await request(app.getHttpServer())
          .post(MODERATORS)
          .set('Cookie', admin.cookie)
          .send({ ...body(), [field]: 'ACTIVE' })
          .expect(400);

        expect(res.body.errors[0].field).toBe(field);
      },
      SLOW_MS,
    );
  });

  // The point of ACC-13 is not the row in `users`: it is that the account it
  // creates can do a moderator's job and nothing else. That crosses into the
  // flights module, so it is checked here rather than assumed.
  describe('the account ACC-13 creates actually works (FLT-01)', () => {
    /** A moderator past its first-login password change, ready to use the API. */
    async function readyModerator(): Promise<string> {
      const created = await createModerator({ password: 'Welcome2026' });
      expect(created.status).toBe(201);
      const cookie = await login(
        app,
        created.body.account.email,
        'Welcome2026',
      );
      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', cookie)
        .send({ currentPassword: 'Welcome2026', newPassword: 'Chosen2026' })
        .expect(200);
      return cookie;
    }

    it('can edit the airline it was assigned to', async () => {
      const cookie = await readyModerator();

      const res = await request(app.getHttpServer())
        .patch(`/api/airlines/${airlineId}`)
        .set('Cookie', cookie)
        .send({ name: 'test_c2_acc13 Airline Renamed' })
        .expect(200);

      expect(res.body.name).toBe('test_c2_acc13 Airline Renamed');
    }, SLOW_MS);

    // ACC-11, and the reason the link is a collection rather than a flag: the
    // moderator's own row says nothing about which airline it manages, so the
    // only thing that can grant this is the assignment document.
    it('cannot edit an airline it was not assigned to', async () => {
      const cookie = await readyModerator();
      const otherAirlineId = await createAirline('acc13-other-airline');

      const res = await request(app.getHttpServer())
        .patch(`/api/airlines/${otherAirlineId}`)
        .set('Cookie', cookie)
        .send({ name: 'test_c2_should_not_happen' })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    }, SLOW_MS);

    it('cannot create an airline: that stays admin-only', async () => {
      const cookie = await readyModerator();

      await request(app.getHttpServer())
        .post('/api/airlines')
        .set('Cookie', cookie)
        .send({ name: 'test_c2_acc13 Not Allowed', iataCode: randomIataCode() })
        .expect(403);
    }, SLOW_MS);
  });

  // A moderator is a new kind of account, so the admin routes built for
  // ACC-07a, ACC-14 and ACC-16 have to handle it like any other.
  describe('the admin account routes handle a moderator (ACC-07a, ACC-14, ACC-16)', () => {
    it('lists it under the AIRLINE_MODERATOR role filter (ACC-14)', async () => {
      const created = await createModerator();
      expect(created.status).toBe(201);

      const res = await request(app.getHttpServer())
        .get(
          `/api/admin/accounts?role=${Role.AIRLINE_MODERATOR}` +
            `&search=${encodeURIComponent(created.body.account.email)}`,
        )
        .set('Cookie', admin.cookie)
        .expect(200);

      expect(res.body.meta.totalItems).toBe(1);
      expect(res.body.items[0].id).toBe(created.body.account.id);
      expect(res.body.items[0].role).toBe(Role.AIRLINE_MODERATOR);
    }, SLOW_MS);

    it('resets its password back to a temporary one (ACC-07a)', async () => {
      const created = await createModerator({ password: 'Welcome2026' });
      const id = created.body.account.id as string;

      const reset = await request(app.getHttpServer())
        .post(`/api/admin/users/${id}/reset-password`)
        .set('Cookie', admin.cookie)
        .expect(200);

      // Back to owing a password change, exactly as ACC-13 left it.
      const cookie = await login(
        app,
        created.body.account.email,
        reset.body.temporaryPassword as string,
      );
      const blocked = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', cookie)
        .expect(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }, SLOW_MS);

    it('suspends it, and the suspension stops it editing its airline (ACC-16)', async () => {
      const created = await createModerator({ password: 'Welcome2026' });
      const id = created.body.account.id as string;
      const cookie = await login(
        app,
        created.body.account.email,
        'Welcome2026',
      );
      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', cookie)
        .send({ currentPassword: 'Welcome2026', newPassword: 'Chosen2026' })
        .expect(200);

      const suspended = await request(app.getHttpServer())
        .patch(`/api/admin/accounts/${id}/suspend`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(suspended.body.status).toBe(UserStatus.SUSPENDED);

      // The guard reloads the account every request, so the cookie it already
      // holds stops working without anything being revoked. The assignment row
      // stays: suspension is not unassignment.
      await request(app.getHttpServer())
        .patch(`/api/airlines/${airlineId}`)
        .set('Cookie', cookie)
        .send({ name: 'test_c2_acc13 Airline Suspended Edit' })
        .expect(401);

      const links = await assignmentModel
        .countDocuments({ moderatorId: new Types.ObjectId(id) })
        .exec();
      expect(links).toBe(1);
    }, SLOW_MS);
  });

  describe('access (ACC-11)', () => {
    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer())
        .post(MODERATORS)
        .send(body())
        .expect(401);
    });

    it('rejects a logged-in non-admin (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', plainUser.cookie)
        .send(body())
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    }, SLOW_MS);

    it('rejects a moderator trying to create another moderator (403)', async () => {
      const created = await createModerator({ password: 'Welcome2026' });
      const cookie = await login(
        app,
        created.body.account.email,
        'Welcome2026',
      );
      await request(app.getHttpServer())
        .patch(CHANGE_PASSWORD)
        .set('Cookie', cookie)
        .send({ currentPassword: 'Welcome2026', newPassword: 'Chosen2026' })
        .expect(200);

      await request(app.getHttpServer())
        .post(MODERATORS)
        .set('Cookie', cookie)
        .send(body())
        .expect(403);
    }, SLOW_MS);
  });
});
