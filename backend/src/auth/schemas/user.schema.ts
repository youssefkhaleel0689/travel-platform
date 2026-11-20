import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role, UserStatus } from '../../common/auth/auth.enums';

export type UserDocument = HydratedDocument<User>;

// Collection name is pinned so Mongoose never pluralises it (schema section 1).
@Schema({ collection: 'users', versionKey: false, timestamps: true })
export class User {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
  })
  email: string;

  // bcrypt hash only. Never returned by default; login selects it explicitly.
  @Prop({ type: String, required: true, select: false })
  passwordHash: string;

  // Format rules belong to ACC-09.
  @Prop({ type: String, trim: true, default: null })
  phone: string | null;

  // A code from the currencies reference data, checked by ReferenceDataService when set (ACC-09).
  @Prop({ type: String, trim: true, uppercase: true, default: null })
  preferredCurrency: string | null;

  @Prop({
    type: String,
    enum: Object.values(Role),
    required: true,
    default: Role.USER,
  })
  role: Role;

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    required: true,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  // Set by register (ACC-01). Null for seeded admins and admin-created moderators.
  @Prop({ type: Date, default: null })
  termsAcceptedAt: Date | null;

  // ACC-02: null until the verification link is used. Seeded admins and
  // admin-created moderators are verified at creation.
  @Prop({ type: Date, default: null })
  emailVerifiedAt: Date | null;

  // Lockout counter (ACC-05).
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  failedLoginAttempts: number;

  // Lockout end (ACC-05).
  @Prop({ type: Date, default: null })
  lockedUntil: Date | null;

  // Forces a password change at next login (ACC-07a, ACC-13).
  @Prop({ type: Boolean, required: true, default: false })
  mustChangePassword: boolean;

  // When an admin issued the temporary password (ACC-07a). Cleared when the
  // account chooses its own.
  @Prop({ type: Date, default: null })
  temporaryPasswordIssuedAt: Date | null;

  // When an admin suspended the account (ACC-15, ACC-16). Null while it is not.
  @Prop({ type: Date, default: null })
  suspendedAt: Date | null;

  // When the owner deactivated the account (ACC-12). Nothing is ever deleted,
  // so past bookings, payments and refunds still point at a real account.
  @Prop({ type: Date, default: null })
  deactivatedAt: Date | null;

  // Added by `timestamps: true`. createdAt is the registration date (ACC-14).
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// The index, not an application check, guarantees uniqueness under concurrent registrations.
UserSchema.index({ email: 1 }, { unique: true });

// ACC-14: the admin account list filters by role and status and sorts by
// registration date.
UserSchema.index({ role: 1, status: 1, createdAt: -1 });
