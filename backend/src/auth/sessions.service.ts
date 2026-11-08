import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  REFRESH_TOKEN_DAYS,
  SESSION_INACTIVITY_MINUTES,
} from './auth.constants';
import { Session, SessionDocument } from './schemas/session.schema';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface CreatedSession {
  sessionId: string;
  refreshToken: string;
}

/**
 * Owns the sessions collection (ACC-06, ACC-19). Login creates a session,
 * every authenticated request touches it, and logout, a password change or an
 * admin action revokes it.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name)
    private readonly sessionModel: Model<Session>,
  ) {}

  /** Called by login (ACC-04) once the password has been verified. */
  async create(
    userId: Types.ObjectId,
    refreshTokenHash: string,
    now = new Date(),
  ): Promise<SessionDocument> {
    return this.sessionModel.create({
      userId,
      refreshTokenHash,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_DAYS * DAY_MS),
      revokedAt: null,
    });
  }

  /**
   * Returns the session only while it is usable: not revoked, before its
   * absolute end, and active within the last 30 minutes (ACC-06). The same
   * call records the activity, so the window slides with real use.
   *
   * findOneAndUpdate does the check and the touch in one atomic operation, so
   * two parallel requests cannot both read a stale lastActivityAt.
   */
  async touchIfUsable(
    sessionId: string,
    now = new Date(),
  ): Promise<SessionDocument | null> {
    if (!Types.ObjectId.isValid(sessionId)) {
      return null;
    }
    const inactiveSince = new Date(
      now.getTime() - SESSION_INACTIVITY_MINUTES * MINUTE_MS,
    );
    return this.sessionModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(sessionId),
          revokedAt: null,
          expiresAt: { $gt: now },
          lastActivityAt: { $gt: inactiveSince },
        },
        { $set: { lastActivityAt: now } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /** ACC-06: logout. Revoking twice is harmless. */
  async revoke(sessionId: string, now = new Date()): Promise<void> {
    if (!Types.ObjectId.isValid(sessionId)) {
      return;
    }
    await this.sessionModel
      .updateOne(
        { _id: new Types.ObjectId(sessionId), revokedAt: null },
        { $set: { revokedAt: now } },
      )
      .exec();
  }

  /**
   * Ends every open session of one user. Used by a password change (ACC-08),
   * an admin password reset (ACC-07a), suspension (ACC-16) and deactivation
   * (ACC-12), so a stolen or stale cookie stops working immediately.
   *
   * `exceptSessionId` keeps the caller's own session alive, which is what a
   * password change wants: the other devices have to sign in again, the device
   * that made the change does not.
   */
  async revokeAllForUser(
    userId: Types.ObjectId,
    options: { exceptSessionId?: string; now?: Date } = {},
  ): Promise<number> {
    const now = options.now ?? new Date();
    const filter: Record<string, unknown> = { userId, revokedAt: null };
    if (options.exceptSessionId && Types.ObjectId.isValid(options.exceptSessionId)) {
      filter._id = { $ne: new Types.ObjectId(options.exceptSessionId) };
    }
    const result = await this.sessionModel
      .updateMany(filter, { $set: { revokedAt: now } })
      .exec();
    return result.modifiedCount;
  }

  /** Looks up a session by the raw refresh token's hash (token rotation). */
  async findByRefreshTokenHash(
    refreshTokenHash: string,
    now = new Date(),
  ): Promise<SessionDocument | null> {
    return this.sessionModel
      .findOne({
        refreshTokenHash,
        revokedAt: null,
        expiresAt: { $gt: now },
      })
      .exec();
  }
}
