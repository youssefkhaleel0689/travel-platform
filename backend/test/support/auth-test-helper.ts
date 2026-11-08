// Helpers for e2e tests that need a signed-in account.
//
// Login (ACC-04) is not implemented yet, so a test cannot POST /api/auth/login
// to get a cookie. These helpers build the same state login will: a user row, a
// sessions row and a signed access token, then hand back the cookie header.
// Once login exists, only createSignedInUser needs to change.
//
// Every account created here has a test_c2_ email prefix, as the shared
// database rules require, and deleteTestUsers removes exactly those rows.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ACCESS_TOKEN_COOKIE } from '../../src/auth/auth.constants';
import { AuthTokensService } from '../../src/auth/auth-tokens.service';
import { Role } from '../../src/auth/enums/role.enum';
import { Session } from '../../src/auth/schemas/session.schema';
import { User } from '../../src/auth/schemas/user.schema';
import { SessionsService } from '../../src/auth/sessions.service';
import { UsersService } from '../../src/auth/users.service';

export const TEST_EMAIL_PREFIX = 'test_c2_';

export interface SignedInUser {
  userId: string;
  sessionId: string;
  email: string;
  password: string;
  /** Ready for supertest: .set('Cookie', cookie) */
  cookie: string;
}

let counter = 0;

/** A unique address per account, so parallel runs never collide. */
export function testEmail(label = 'user'): string {
  counter += 1;
  return `${TEST_EMAIL_PREFIX}${label}_${Date.now()}_${counter}@example.com`;
}

export async function createSignedInUser(
  app: INestApplication,
  options: {
    role?: Role;
    password?: string;
    label?: string;
    mustChangePassword?: boolean;
    preferredCurrency?: string | null;
  } = {},
): Promise<SignedInUser> {
  const users = app.get(UsersService);
  const sessions = app.get(SessionsService);
  const tokens = app.get(AuthTokensService);

  const password = options.password ?? 'TestPass123';
  const email = testEmail(options.label);

  const user = await users.create({
    name: 'C2 Test Account',
    email,
    password,
    role: options.role ?? Role.USER,
    mustChangePassword: options.mustChangePassword,
    preferredCurrency: options.preferredCurrency ?? null,
  });

  const refreshToken = tokens.generateRefreshToken();
  const session = await sessions.create(
    user._id,
    tokens.hashRefreshToken(refreshToken),
  );
  const accessToken = await tokens.signAccessToken({
    sub: user._id.toString(),
    sid: session._id.toString(),
    role: user.role,
  });

  return {
    userId: user._id.toString(),
    sessionId: session._id.toString(),
    email,
    password,
    cookie: `${ACCESS_TOKEN_COOKIE}=${accessToken}`,
  };
}

/** A cookie for a session that no longer exists, i.e. a signed-out token. */
export async function cookieForUnknownSession(
  app: INestApplication,
  userId: string,
): Promise<string> {
  const tokens = app.get(AuthTokensService);
  const accessToken = await tokens.signAccessToken({
    sub: userId,
    sid: new Types.ObjectId().toString(),
    role: Role.USER,
  });
  return `${ACCESS_TOKEN_COOKIE}=${accessToken}`;
}

/** Removes every account this suite created, and their sessions. */
export async function deleteTestUsers(
  app: INestApplication,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const sessionModel = app.get<Model<Session>>(getModelToken(Session.name));
  const ids = userIds.map((id) => new Types.ObjectId(id));

  await sessionModel.deleteMany({ userId: { $in: ids } }).exec();
  // The email guard makes certain this never deletes a teammate's data.
  await userModel
    .deleteMany({
      _id: { $in: ids },
      email: { $regex: `^${TEST_EMAIL_PREFIX}` },
    })
    .exec();
}
