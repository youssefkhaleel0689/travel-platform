import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';

/** ACC-02: single-use email verification link (30 minutes). */
@Schema({ collection: 'emailVerificationTokens', timestamps: true })
export class EmailVerificationToken {
  _id: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  // Only a SHA-256 hash is stored; the raw token lives in the email link.
  @Prop({ type: String, required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  usedAt: Date | null;
}

export const EmailVerificationTokenSchema = SchemaFactory.createForClass(
  EmailVerificationToken,
);
EmailVerificationTokenSchema.index({ userId: 1 });

/** ACC-07: single-use password reset link (30 minutes, invalidated by a newer one). */
@Schema({ collection: 'passwordResetTokens', timestamps: true })
export class PasswordResetToken {
  _id: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  usedAt: Date | null;
}

export const PasswordResetTokenSchema =
  SchemaFactory.createForClass(PasswordResetToken);
PasswordResetTokenSchema.index({ userId: 1 });
