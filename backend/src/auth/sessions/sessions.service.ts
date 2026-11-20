import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import {
  REFRESH_TOKEN_BYTES,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_ACTIVITY_WRITE_INTERVAL_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from './session.constants';
import { Session } from './session.schema';

export interface CreatedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface RotatedSession {
  sessionId: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date;
}

// A route id is always 24 hex characters (same check as UsersService).
const OBJECT_ID = /^[0-9a-f]{24}$/i;

// Exactly what generateRefreshToken() produces: REFRESH_TOKEN_BYTES in unpadded base64url.
const REFRESH_TOKEN = new RegExp(
  `^[A-Za-z0-9_-]{${Math.ceil((REFRESH_TOKEN_BYTES * 8) / 6)}}$`,
);

function isObjectId(id: string): boolean {
  return OBJECT_ID.test(id);
}

function isRefreshToken(token: string): boolean {
  return REFRESH_TOKEN.test(token);
}

function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256, not bcrypt: the token is 256 random bits, so guessing it is infeasible and a
 * slow, salted hash adds nothing. An unsalted, deterministic hash also lets a refresh find
 * its session through the unique index on refreshTokenHash. Only the hash is stored, so a
 * database leak does not reveal usable tokens.
 */
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// The conditions every live session meets at `now`: not revoked, not past its absolute
// end, and active within the idle timeout.
function liveAt(now: Date) {
  return {
    revokedAt: null,
    expiresAt: { $gt: now },
    lastActivityAt: {
      $gt: new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS),
    },
  };
}

/**
 * Login sessions (ACC-06). A session is one login on one device: it holds the hash of its
 * current refresh token and ends when it is revoked (logout, or all of a user's sessions at
 * once), after SESSION_IDLE_TIMEOUT_MS without activity, or SESSION_ABSOLUTE_LIFETIME_MS
 * after login, whichever comes first. Every check is done in the query filter, so an
 * ended session is never matched; the TTL index only cleans up afterwards.
 *
 * The guard (next commit) calls validateForRequest() on every request, which also records
 * activity at most once per SESSION_ACTIVITY_WRITE_INTERVAL_MS. Nothing here returns the
 * token hash or a Mongoose document; ids are returned as strings.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  /** Starts a session for a logged-in user. The plain refresh token is returned once. */
  async create(userId: string, now = new Date()): Promise<CreatedSession> {
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);
    const created = await this.sessionModel.create({
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      lastActivityAt: now,
      revokedAt: null,
      expiresAt,
    });
    return { sessionId: created._id.toString(), refreshToken, expiresAt };
  }

  /**
   * True when the session exists, belongs to the user and is live. Records activity with
   * one conditional update when the last recorded activity is at least
   * SESSION_ACTIVITY_WRITE_INTERVAL_MS old; the filter repeats every condition, so
   * parallel requests write at most once and never revive an ended session.
   */
  async validateForRequest(
    sessionId: string,
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    if (!isObjectId(sessionId) || !isObjectId(userId)) {
      return false;
    }
    const filter = { _id: sessionId, userId, ...liveAt(now) };
    const session = await this.sessionModel
      .findOne(filter)
      .select('lastActivityAt')
      .lean<Pick<Session, 'lastActivityAt'>>()
      .exec();
    if (!session) {
      return false;
    }

    const writeBefore = new Date(
      now.getTime() - SESSION_ACTIVITY_WRITE_INTERVAL_MS,
    );
    if (session.lastActivityAt.getTime() <= writeBefore.getTime()) {
      await this.sessionModel
        .updateOne(
          {
            ...filter,
            lastActivityAt: { ...filter.lastActivityAt, $lte: writeBefore },
          },
          { $set: { lastActivityAt: now } },
        )
        .exec();
    }
    return true;
  }

  /**
   * Exchanges a refresh token for a new one in one atomic update: the old token stops
   * working at once, and of two concurrent rotations of the same token exactly one
   * succeeds. Null when the token is malformed, unknown, or its session has ended.
   */
  async rotate(
    refreshToken: string,
    now = new Date(),
  ): Promise<RotatedSession | null> {
    if (!isRefreshToken(refreshToken)) {
      return null;
    }
    const newToken = generateRefreshToken();
    const session = await this.sessionModel
      .findOneAndUpdate(
        { refreshTokenHash: hashRefreshToken(refreshToken), ...liveAt(now) },
        {
          $set: {
            refreshTokenHash: hashRefreshToken(newToken),
            lastActivityAt: now,
          },
        },
        { returnDocument: 'after' },
      )
      .lean<Session>()
      .exec();
    if (!session) {
      return null;
    }
    return {
      sessionId: session._id.toString(),
      userId: session.userId.toString(),
      refreshToken: newToken,
      expiresAt: session.expiresAt,
    };
  }

  /** Ends one session (logout). A no-op for a malformed id or an already revoked session. */
  async revoke(sessionId: string, now = new Date()): Promise<void> {
    if (!isObjectId(sessionId)) {
      return;
    }
    await this.sessionModel
      .updateOne(
        { _id: sessionId, revokedAt: null },
        { $set: { revokedAt: now } },
      )
      .exec();
  }

  /**
   * Ends the session holding this refresh token: logout when the access token has already
   * expired. A no-op for a malformed or unknown token.
   */
  async revokeByRefreshToken(
    refreshToken: string,
    now = new Date(),
  ): Promise<void> {
    if (!isRefreshToken(refreshToken)) {
      return;
    }
    await this.sessionModel
      .updateOne(
        { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
        { $set: { revokedAt: now } },
      )
      .exec();
  }

  /**
   * Ends every live session of a user, optionally except one, and returns how many were
   * revoked (0 for a malformed userId, without querying). Callers:
   * - ACC-07a (admin password reset) and ACC-16 (suspension): no exception;
   * - ACC-08 (password change): exceptSessionId = the caller's current session, so every
   *   other device is signed out but the one that made the change stays logged in;
   * - ACC-12 (deactivation): no exception.
   * Idea credited to C2's ACC-08 branch (revokeAllForUser).
   */
  async revokeAllSessions(
    userId: string,
    options: { exceptSessionId?: string; now?: Date } = {},
  ): Promise<number> {
    if (!isObjectId(userId)) {
      return 0;
    }
    const { exceptSessionId, now = new Date() } = options;
    // A malformed exceptSessionId is ignored, so every session is revoked: the safe
    // direction is to revoke more, never to leave a session open by mistake.
    const except =
      exceptSessionId !== undefined && isObjectId(exceptSessionId)
        ? { _id: { $ne: exceptSessionId } }
        : {};
    const result = await this.sessionModel
      .updateMany(
        { userId, revokedAt: null, ...except },
        { $set: { revokedAt: now } },
      )
      .exec();
    return result.modifiedCount;
  }
}
