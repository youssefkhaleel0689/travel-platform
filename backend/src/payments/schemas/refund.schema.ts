import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  BOOKING_TYPES,
  BookingType,
} from '../../common/bookings/booking-status';
import { PLATFORM_CURRENCY } from '../../common/money/money';
import {
  CancelledBy,
  REFUND_STATUSES,
  RefundStatus,
} from '../refund-status.enum';
import { Payment } from './payment.schema';

export type RefundDocument = HydratedDocument<Refund>;

/**
 * PAY-03: one refund of one payment.
 *
 * The row is written before Stripe is called and updated with the outcome, so
 * a refund that was attempted is never invisible: if Stripe fails or the
 * process dies mid-call, the record still shows PENDING or FAILED on the
 * booking rather than nothing at all.
 */
@Schema({ collection: 'refunds', timestamps: true })
export class Refund {
  @Prop({ type: String, required: true, enum: BOOKING_TYPES })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Payment.name, required: true })
  paymentId: Types.ObjectId;

  /** Stripe's id (re_...). Null until Stripe has answered. */
  @Prop({ type: String, default: null })
  stripeRefundId: string | null;

  // Decimal128, never a float. Always greater than zero: a 0% tier produces no
  // refund row at all.
  @Prop({ type: Types.Decimal128, required: true })
  amount: Types.Decimal128;

  @Prop({ type: String, required: true, default: PLATFORM_CURRENCY })
  currency: string;

  @Prop({ type: String, required: true, enum: REFUND_STATUSES })
  status: RefundStatus;

  @Prop({ type: String, required: true, enum: Object.values(CancelledBy) })
  cancelledBy: CancelledBy;

  /** Why it was cancelled, shown on the booking details. */
  @Prop({ type: String, required: true, trim: true, maxlength: 500 })
  reason: string;

  /** The tier that was applied: 100 for a provider cancellation. */
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage: number;

  /**
   * The cancellation terms the percentage came from, copied verbatim, so the
   * amount can still be explained after the provider edits its policy.
   */
  @Prop({ type: Object, default: null })
  policySnapshot: Record<string, unknown> | null;

  /**
   * Deterministic key, "refund:<type>:<bookingId>:<n>". Sent to Stripe as its
   * idempotency key and unique here, so a cancellation that runs twice cannot
   * refund twice.
   */
  @Prop({ type: String, required: true, unique: true })
  idempotencyKey: string;

  @Prop({ type: Date, required: true })
  requestedAt: Date;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  /** Stripe's message when it refused, kept for whoever retries it. */
  @Prop({ type: String, default: null })
  failureMessage: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);

// The refunds of one booking, for the booking details and for the
// "total refunds never exceed what was captured" check.
RefundSchema.index({ bookingType: 1, bookingId: 1, createdAt: -1 });
RefundSchema.index({ paymentId: 1 });
// Stripe's id must be unique, but it is null until Stripe answers and many
// refunds can be waiting at once.
//
// A partial index, not a sparse one: sparse only skips documents where the
// field is absent, and this field has an explicit null default, so a sparse
// unique index would reject the second refund that is still waiting. The
// partial filter indexes only the rows that actually have an id.
RefundSchema.index(
  { stripeRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeRefundId: { $type: 'string' } },
  },
);
