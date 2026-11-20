import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { jsonTransform } from '../../common/mongo';

export type HotelPolicyDocument = HydratedDocument<HotelPolicy>;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

@Schema({ _id: false })
export class CancellationTier {
  @Prop({ type: Number, required: true, min: 0, validate: Number.isInteger })
  daysBeforeCheckIn!: number;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage!: number;
}
export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

@Schema({
  collection: 'hotelPolicies',
  timestamps: true,
  toJSON: { transform: jsonTransform, versionKey: false },
})
export class HotelPolicy {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: mongoose.Types.ObjectId;

  @Prop({ type: String, required: true, match: HHMM }) checkInTime!: string;
  @Prop({ type: String, required: true, match: HHMM }) checkOutTime!: string;

  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers!: CancellationTier[];

  @Prop({
    type: Number,
    required: true,
    default: 1,
    min: 1,
    validate: Number.isInteger,
  })
  version!: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  updatedBy?: mongoose.Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const HotelPolicySchema = SchemaFactory.createForClass(HotelPolicy);
HotelPolicySchema.index({ hotelId: 1 }, { unique: true });
