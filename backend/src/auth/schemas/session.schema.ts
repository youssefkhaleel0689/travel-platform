import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from './user.schema';

export type SessionDocument = HydratedDocument<Session>;

// One row per login (ACC-06, ACC-19). The raw refresh token is never stored:
// only its SHA-256 hash, so a database leak cannot be replayed as a login.
@Schema({ collection: 'sessions', timestamps: true })
export class Session {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, select: false })
  refreshTokenHash: string;

  // Touched on every authenticated request; 30 minutes of silence expires the
  // session (ACC-06).
  @Prop({ type: Date, required: true })
  lastActivityAt: Date;

  // Absolute end of the session, whatever the activity.
  @Prop({ type: Date, required: true })
  expiresAt: Date;

  // Set by logout, by a password change and by suspension or deactivation.
  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// Revoking every session of one user, and clearing expired rows, both read
// these two fields together.
SessionSchema.index({ userId: 1, revokedAt: 1 });
SessionSchema.index({ expiresAt: 1 });
