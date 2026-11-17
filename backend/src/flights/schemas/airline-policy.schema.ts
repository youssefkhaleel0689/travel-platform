import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type AirlinePolicyDocument = HydratedDocument<AirlinePolicy>;

const isWholeNumber = (value: number): boolean => Number.isInteger(value);

// Money is Decimal128, never a float. null means "not defined yet".
const isNullOrPositiveDecimal = (value: Types.Decimal128 | null): boolean => {
  if (value === null) {
    return true;
  }
  const amount = Number(value.toString());
  return Number.isFinite(amount) && amount > 0;
};

// One cancellation tier, embedded in airlinePolicies.cancellationTiers[] (schema section 3,
// FLT-09). A tier has no _id of its own: it is identified by its day threshold.
@Schema({ _id: false, versionKey: false, timestamps: false })
export class CancellationTier {
  // Days before departure at which this tier starts to apply. Whole number >= 0.
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: isWholeNumber,
      message: 'daysBeforeDeparture must be a whole number',
    },
  })
  daysBeforeDeparture: number;

  // Refund percentage of the booking total, 0 to 100.
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage: number;
}

export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

// Each daysBeforeDeparture threshold may appear once (FLT-09).
const hasUniqueThresholds = (tiers: CancellationTier[]): boolean =>
  new Set(tiers.map((tier) => tier.daysBeforeDeparture)).size === tiers.length;

// Policy of one airline (schema section 2.2, FLT-08 and FLT-09): one document per airline,
// created by whichever of the two PUT endpoints is called first. A part that was never
// defined is null (baggage) or empty (tiers). version goes up on every change; a booking
// stores a snapshot of the policy, so later edits never change an existing booking.
// The maximum weight of an extra bag is not stored: it equals the maxBagWeightKg of the
// booked cabin (FLT-08).
@Schema({ collection: 'airlinePolicies', versionKey: false, timestamps: true })
export class AirlinePolicy {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  airlineId: Types.ObjectId;

  // Price per extra bag in the platform currency. Decimal128, > 0 once defined.
  @Prop({
    type: SchemaTypes.Decimal128,
    default: null,
    validate: {
      validator: isNullOrPositiveDecimal,
      message: 'extraBagPrice must be greater than 0',
    },
  })
  extraBagPrice: Types.Decimal128 | null;

  // Extra bags allowed per passenger. Whole number >= 0 once defined (0 = no extra bags).
  @Prop({
    type: Number,
    default: null,
    min: 0,
    validate: {
      validator: (value: number | null): boolean =>
        value === null || isWholeNumber(value),
      message: 'maxExtraBagsPerPassenger must be a whole number',
    },
  })
  maxExtraBagsPerPassenger: number | null;

  @Prop({
    type: [CancellationTierSchema],
    default: [],
    validate: {
      validator: hasUniqueThresholds,
      message: 'daysBeforeDeparture must be unique within cancellationTiers',
    },
  })
  cancellationTiers: CancellationTier[];

  // Starts at 1 and goes up by 1 on every change. Set with $inc, so it has no default.
  @Prop({ type: Number, required: true, min: 1 })
  version: number;

  // The moderator who made the last change.
  @Prop({ type: Types.ObjectId, required: true })
  updatedBy: Types.ObjectId;

  // Added by `timestamps: true`.
  createdAt: Date;
  updatedAt: Date;
}

export const AirlinePolicySchema = SchemaFactory.createForClass(AirlinePolicy);

// One policy per airline.
AirlinePolicySchema.index({ airlineId: 1 }, { unique: true });
