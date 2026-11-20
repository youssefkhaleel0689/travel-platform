import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type StripeWebhookEventDocument = HydratedDocument<StripeWebhookEvent>;

export enum WebhookEventStatus {
  /** Claimed by this process and being handled. */
  PROCESSING = 'PROCESSING',
  /** Handled; a later delivery of the same event does nothing. */
  PROCESSED = 'PROCESSED',
  /** Handling threw. The error is kept so it can be looked into. */
  FAILED = 'FAILED',
  /** A type this backend does not act on. */
  IGNORED = 'IGNORED',
}

/**
 * One row per Stripe event id, which is what makes webhook handling exactly
 * once.
 *
 * Stripe retries a webhook until it gets a 2xx, and can deliver the same
 * event more than once anyway. Without this, a retried
 * payment_intent.succeeded would confirm a booking twice and could release or
 * convert inventory twice. The unique index on stripeEventId turns the second
 * delivery into a no-op: inserting the row is how a process claims the event.
 */
@Schema({ collection: 'stripeWebhookEvents', timestamps: true })
export class StripeWebhookEvent {
  // Stripe's event id (evt_...).
  @Prop({ type: String, required: true, unique: true })
  stripeEventId: string;

  @Prop({ type: String, required: true })
  type: string;

  /** The booking the event concerns, when it names one. */
  @Prop({ type: SchemaTypes.ObjectId, default: null })
  bookingId: Types.ObjectId | null;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(WebhookEventStatus),
  })
  status: WebhookEventStatus;

  @Prop({ type: Date, required: true })
  receivedAt: Date;

  @Prop({ type: Date, default: null })
  processedAt: Date | null;

  /** Why handling failed, for whoever has to look into it later. */
  @Prop({ type: String, default: null })
  error: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export const StripeWebhookEventSchema =
  SchemaFactory.createForClass(StripeWebhookEvent);

// Finding events that were claimed but never finished.
StripeWebhookEventSchema.index({ status: 1, receivedAt: 1 });
