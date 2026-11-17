import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { User } from '../schemas/user.schema';

export type SessionDocument = HydratedDocument<Session>;

// One login session (ACC-06). Collection name pinned, as for users. Only createdAt is
// kept: lastActivityAt records activity, and nothing else on a session is edited.
@Schema({
  collection: 'sessions',
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
})
export class Session {
  _id: Types.ObjectId;

  // SchemaTypes.ObjectId, not Types.ObjectId. Through Nest's @Prop the second one
  // compiles to a Mixed path, which casts nothing: SessionsService passes the string
  // user id from the token, so it was stored as a string, and a query with an ObjectId
  // (or ownerFilter on a casting path elsewhere) never matched it. This path casts the
  // string to an ObjectId on every write and query.
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  // SHA-256 hex of the current refresh token; the plain token is never stored. Never
  // returned by default.
  @Prop({ type: String, required: true, select: false })
  refreshTokenHash: string;

  // Last request or refresh, written at most once a minute (idle expiry, ACC-06).
  @Prop({ type: Date, required: true })
  lastActivityAt: Date;

  // Set by logout or by revoking all of a user's sessions; null while the session is live.
  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  // Absolute end of the session (login + SESSION_ABSOLUTE_LIFETIME_MS).
  @Prop({ type: Date, required: true })
  expiresAt: Date;

  // Added by the timestamps option.
  createdAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// Revoking all of a user's sessions (ACC-07a, ACC-12, ACC-16) filters by userId.
SessionSchema.index({ userId: 1 });
// A refresh looks the session up by its token hash; unique so a hash names one session.
SessionSchema.index({ refreshTokenHash: 1 }, { unique: true });
// TTL: MongoDB deletes a session in the background once expiresAt has passed. The deletion
// can lag by a minute or more, so the code still checks expiresAt itself.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
