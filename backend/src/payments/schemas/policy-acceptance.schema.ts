import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { User } from '../../auth/schemas/user.schema';
import {
  BOOKING_TYPES,
  BookingType,
  ProviderType,
} from '../../common/bookings/booking-status';

export type PolicyAcceptanceDocument = HydratedDocument<PolicyAcceptance>;

/**
 * PAY-02: proof that the user saw and accepted the provider's terms before
 * paying. Payment is refused without a row that matches the booking's policy
 * version.
 *
 * The row is written once and never edited: it is evidence of what was agreed
 * and when. A provider that later changes its policy raises its own version,
 * which leaves this record untouched.
 */
@Schema({ collection: 'policyAcceptances', timestamps: true })
export class PolicyAcceptance {
  @Prop({ type: String, required: true, enum: BOOKING_TYPES })
  bookingType: BookingType;

  // The booking in the flights or hotels module. Not a ref: the two booking
  // collections are owned by other modules and a booking is always read
  // through BookingsPort, never populated from here.
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(ProviderType),
  })
  providerType: ProviderType;

  // A string: an airline id and a hotel id are both ObjectIds today, but this
  // field only ever identifies the provider in a record, never joins to it.
  @Prop({ type: String, required: true })
  providerId: string;

  @Prop({ type: Number, required: true, min: 0 })
  policyVersion: number;

  /**
   * The exact terms as shown, copied in full. Schema-less on purpose: an
   * airline's terms and a hotel's have different shapes, and this is a
   * verbatim record, not something to query on.
   */
  @Prop({ type: Object, required: true })
  policySnapshot: Record<string, unknown>;

  /** Always true: a row exists only because the user accepted (PAY-02). */
  @Prop({ type: Boolean, required: true, default: true })
  accepted: boolean;

  @Prop({ type: Date, required: true })
  acceptedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const PolicyAcceptanceSchema =
  SchemaFactory.createForClass(PolicyAcceptance);

// One acceptance per booking per policy version. Accepting twice is therefore
// idempotent rather than a second row, and a race between two clicks ends as a
// duplicate-key conflict instead of two acceptances.
PolicyAcceptanceSchema.index(
  { bookingType: 1, bookingId: 1, policyVersion: 1 },
  { unique: true },
);
