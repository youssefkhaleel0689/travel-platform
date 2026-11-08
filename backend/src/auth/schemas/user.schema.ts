import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { CURRENCY_CODE } from '../../common/reference-data/reference-data.patterns';
import { Role, ROLES } from '../enums/role.enum';
import { UserStatus, USER_STATUSES } from '../enums/user-status.enum';

export type UserDocument = HydratedDocument<User>;

// One account for every registered user, moderator and admin (ACC-01, ACC-18).
// Only a salted hash of the password is ever stored (GEN-13).
@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name: string;

  // Stored lowercase and trimmed so "A@b.com" and "a@b.com" are one account.
  @Prop({
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  })
  email: string;

  // bcrypt hash. Never selected by default, so no query can leak it.
  @Prop({ type: String, required: true, select: false })
  passwordHash: string;

  @Prop({ type: String, default: null, trim: true })
  phone: string | null;

  // ACC-09, PAY-04: display currency for itinerary budgets only. Booking
  // prices, payments and refunds always use the platform currency.
  @Prop({ type: String, default: null, uppercase: true, match: CURRENCY_CODE })
  preferredCurrency: string | null;

  @Prop({ type: String, required: true, enum: ROLES, default: Role.USER })
  role: Role;

  @Prop({
    type: String,
    required: true,
    enum: USER_STATUSES,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  // ACC-01: consent is mandatory, and when it was given is kept for the record.
  @Prop({ type: Date, required: true })
  termsAcceptedAt: Date;

  @Prop({ type: String, required: true })
  termsVersion: string;

  // ACC-05: reset to 0 by a successful login.
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  failedLoginAttempts: number;

  // ACC-05: set when the attempts run out; login is refused until it passes.
  @Prop({ type: Date, default: null })
  lockedUntil: Date | null;

  // ACC-07a, ACC-13: the account must choose a new password before it can do
  // anything else.
  @Prop({ type: Boolean, required: true, default: false })
  mustChangePassword: boolean;

  @Prop({ type: Date, default: null })
  temporaryPasswordIssuedAt: Date | null;

  // ACC-12: when the owner deactivated the account.
  @Prop({ type: Date, default: null })
  deactivatedAt: Date | null;

  // ACC-15, ACC-16: when an admin suspended the account.
  @Prop({ type: Date, default: null })
  suspendedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// ACC-14: the admin account list is filtered by role and status and sorted by
// registration date.
UserSchema.index({ role: 1, status: 1, createdAt: -1 });
