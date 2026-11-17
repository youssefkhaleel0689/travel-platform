import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { User } from '../../auth/schemas/user.schema';
import {
  BOOKING_TYPES,
  BookingType,
} from '../../common/bookings/booking-status';
import { PLATFORM_CURRENCY } from '../../common/money/money';
import { PAYMENT_STATUSES, PaymentStatus } from '../payment-status.enum';
import { PolicyAcceptance } from './policy-acceptance.schema';

export type PaymentDocument = HydratedDocument<Payment>;

/**
 * PAY-01: one Stripe PaymentIntent attempt on one booking.
 *
 * Card details never reach this backend and are never stored: the user sends
 * them straight to Stripe with Stripe Elements, and only the PaymentIntent
 * id, the amount, the currency and the status are kept here
 * (noCardCredentials in the schema's invariants).
 */
@Schema({ collection: 'payments', timestamps: true })
export class Payment {
  @Prop({ type: String, required: true, enum: BOOKING_TYPES })
  bookingType: BookingType;

  // Not a ref: the booking collections belong to the flights and hotels
  // modules and are always read through BookingsPort.
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  // Stripe's id (pi_...). Unique, so one PaymentIntent is one row and a
  // retried webhook cannot create a second.
  @Prop({ type: String, required: true, unique: true })
  stripePaymentIntentId: string;

  // Decimal128, never a float (schema section 1). Returned as a string.
  @Prop({ type: Types.Decimal128, required: true })
  amount: Types.Decimal128;

  // PAY-04: always the one platform currency; stored so a stored payment can
  // still be read correctly if the platform currency ever changes.
  @Prop({ type: String, required: true, default: PLATFORM_CURRENCY })
  currency: string;

  @Prop({ type: String, required: true, enum: PAYMENT_STATUSES })
  status: PaymentStatus;

  // PAY-02: which acceptance allowed this payment. A payment cannot exist
  // without one.
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: PolicyAcceptance.name,
    required: true,
  })
  policyAcceptanceId: Types.ObjectId;

  /**
   * Deterministic key, "pay:<type>:<bookingId>:<attempt>". It is sent to
   * Stripe as its idempotency key and is unique here, so a repeated request
   * cannot open a second PaymentIntent for the same attempt.
   */
  @Prop({ type: String, required: true, unique: true })
  idempotencyKey: string;

  /** 1 for the first attempt on a booking, then 2, 3, ... on each retry. */
  @Prop({ type: Number, required: true, min: 1 })
  attempt: number;

  @Prop({ type: Date, default: null })
  succeededAt: Date | null;

  @Prop({ type: Date, default: null })
  failedAt: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  /** Stripe's own message for a failure, shown to the user as-is. */
  @Prop({ type: String, default: null })
  failureMessage: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

// The live attempt on a booking, and the attempt count for the next key.
PaymentSchema.index({ bookingType: 1, bookingId: 1, attempt: -1 });
// The user's own payment list.
PaymentSchema.index({ userId: 1, createdAt: -1 });
// The expiry sweep looks for open payments, oldest first.
PaymentSchema.index({ status: 1, createdAt: 1 });
