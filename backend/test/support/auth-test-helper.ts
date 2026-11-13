// Helpers for e2e tests that need a logged-in account.
//
// These go through the real endpoints now that ACC-01 and ACC-04 are merged:
// POST /api/auth/register creates the account and POST /api/auth/login returns
// the httpOnly access_token cookie. Nothing here mints a token by hand, so a
// test exercises the same path a browser does.
//
// Every account has a test_c2_ email prefix, as the shared-database rules
// require, and deleteTestUsers removes exactly those rows.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role, UserStatus } from '../../src/common/auth/auth.enums';
import { ACCESS_TOKEN_COOKIE } from '../../src/auth/auth.constants';
import { User } from '../../src/auth/schemas/user.schema';
import { UsersService } from '../../src/auth/users/users.service';

export const TEST_EMAIL_PREFIX = 'test_c2_';
export const TEST_PASSWORD = 'TestPass123';

export interface SignedInUser {
  userId: string;
  email: string;
  password: string;
  role: Role;
  /** Ready for supertest: .set('Cookie', cookie) */
  cookie: string;
}

let counter = 0;

/** A unique address per account, so parallel runs never collide. */
export function testEmail(label = 'user'): string {
  counter += 1;
  return `${TEST_EMAIL_PREFIX}${label}_${Date.now()}_${counter}@example.com`;
}

/** Pulls the access-token cookie out of a Set-Cookie header. */
function accessTokenCookie(setCookie: string[] | undefined): string {
  const header = (setCookie ?? []).find((value) =>
    value.startsWith(`${ACCESS_TOKEN_COOKIE}=`),
  );
  if (!header) {
    throw new Error(
      `No ${ACCESS_TOKEN_COOKIE} cookie was set. Login must set it (ACC-19).`,
    );
  }
  // Only the name=value part; the attributes are not sent back by a client.
  return header.split(';')[0];
}

/**
 * Registers an account through the API and returns its login cookie.
 *
 * A role other than USER cannot be registered (ACC-01 creates USER only), so
 * for an ADMIN or a moderator the role is set on the document afterwards and
 * the account logs in again - the same thing the ACC-18 admin seed does.
 */
export async function createSignedInUser(
  app: INestApplication<App>,
  options: {
    role?: Role;
    password?: string;
    label?: string;
    mustChangePassword?: boolean;
  } = {},
): Promise<SignedInUser> {
  const role = options.role ?? Role.USER;
  const password = options.password ?? TEST_PASSWORD;
  const email = testEmail(options.label);

  const registered = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      name: 'C2 Test Account',
      email,
      password,
      acceptTerms: true,
    })
    .expect(201);

  const userId = registered.body.id as string;

  // Anything the registration endpoint cannot set, set directly, then log in
  // again so the cookie reflects it.
  if (role !== Role.USER || options.mustChangePassword) {
    const userModel = app.get<Model<User>>(getModelToken(User.name));
    await userModel
      .updateOne(
        { _id: new Types.ObjectId(userId) },
        {
          $set: {
            role,
            mustChangePassword: options.mustChangePassword ?? false,
            temporaryPasswordIssuedAt: options.mustChangePassword
              ? new Date()
              : null,
          },
        },
      )
      .exec();
  }

  return {
    userId,
    email,
    password,
    role,
    cookie: await login(app, email, password),
  };
}

/** Logs in through the API and returns the access-token cookie. */
export async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return accessTokenCookie(
    response.headers['set-cookie'] as unknown as string[],
  );
}

/**
 * A cookie whose token is valid but whose account no longer passes the guard.
 * Used to prove that the guard reloads the user rather than trusting the token.
 */
export async function cookieForSuspendedAccount(
  app: INestApplication<App>,
  user: SignedInUser,
): Promise<string> {
  await app.get(UsersService).setStatus(user.userId, UserStatus.SUSPENDED);
  return user.cookie;
}

/** Removes every account this suite created. */
export async function deleteTestUsers(
  app: INestApplication<App>,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  // The email guard makes certain this never deletes a teammate's data.
  await userModel
    .deleteMany({
      _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
      email: { $regex: `^${TEST_EMAIL_PREFIX}` },
    })
    .exec();
}
