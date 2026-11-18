import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { jsonTransform } from '../../common/mongo';

export type AvailabilityDocument = HydratedDocument<Availability>;

export enum AvailabilityStatus {
  AVAILABLE = 'AVAILABLE',
  BLOCKED = 'BLOCKED',
}

// BOOKED is never stored: it is derived from CONFIRMED / unexpired PENDING_PAYMENT hotel bookings (HTL-08).
@Schema({ collection: 'availability', timestamps: true, toJSON: { transform: jsonTransform, versionKey: false } })
export class Availability {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true })
  roomId!: mongoose.Types.ObjectId;

  // Interval is [startDate, endDate)
  @Prop({ type: Date, required: true })
  startDate!: Date;

  @Prop({ type: Date, required: true })
  endDate!: Date;

  @Prop({ type: String, enum: Object.values(AvailabilityStatus), required: true })
  status!: AvailabilityStatus;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  createdBy?: mongoose.Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AvailabilitySchema = SchemaFactory.createForClass(Availability);
AvailabilitySchema.index({ roomId: 1, startDate: 1, endDate: 1 });
AvailabilitySchema.index({ hotelId: 1, roomId: 1, status: 1 });

AvailabilitySchema.pre('validate', function () {
  if (this.startDate && this.endDate && this.endDate <= this.startDate) {
    this.invalidate('endDate', 'endDate must be later than startDate');
  }
});
