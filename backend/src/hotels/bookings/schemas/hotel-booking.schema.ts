import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { jsonTransform } from '../../../common/mongo';

export type HotelBookingDocument = HydratedDocument<HotelBooking>;

export enum HotelBookingStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum GuestType {
  ADULT = 'ADULT',
  CHILD = 'CHILD',
}

@Schema({ _id: false })
export class AssignedGuest {
  @Prop({ type: String, enum: Object.values(GuestType), required: true })
  type!: GuestType;

  @Prop({ type: String, trim: true })
  fullName?: string;

  // Required for CHILD (0-17); optional for ADULT. (The original schema capped every guest at 17, which rejected adults.)
  @Prop({ type: Number, min: 0, max: 120, validate: Number.isInteger })
  age?: number;
}
export const AssignedGuestSchema = SchemaFactory.createForClass(AssignedGuest);

@Schema({ _id: false })
export class RoomBookingSnapshot {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true })
  roomId!: mongoose.Types.ObjectId;
  @Prop({ type: String, required: true }) roomNumberSnapshot!: string;
  @Prop({ type: String, required: true }) roomNameSnapshot!: string;
  @Prop({ type: String, required: true }) roomTypeSnapshot!: string;
  @Prop({ type: Number, required: true, min: 1 }) bedsSnapshot!: number;
  @Prop({ type: Number, required: true, min: 1 }) maxOccupancySnapshot!: number;
  @Prop({ type: mongoose.Schema.Types.Decimal128, required: true }) pricePerNightSnapshot!: mongoose.Types.Decimal128;
  @Prop({ type: [AssignedGuestSchema], required: true }) assignedGuests!: AssignedGuest[];
  @Prop({ type: Number, required: true, min: 1, validate: Number.isInteger }) nights!: number;
  @Prop({ type: mongoose.Schema.Types.Decimal128, required: true }) lineTotal!: mongoose.Types.Decimal128;
}
export const RoomBookingSnapshotSchema = SchemaFactory.createForClass(RoomBookingSnapshot);

@Schema({ _id: false })
export class HotelBookingPolicySnapshot {
  @Prop({ type: Number, required: true }) policyVersion!: number;
  @Prop({ type: String, required: true }) checkInTime!: string;
  @Prop({ type: String, required: true }) checkOutTime!: string;
  @Prop({
    type: [{ _id: false, daysBeforeCheckIn: Number, refundPercentage: Number }],
    default: [],
  })
  cancellationTiers!: { daysBeforeCheckIn: number; refundPercentage: number }[];
}
export const HotelBookingPolicySnapshotSchema = SchemaFactory.createForClass(HotelBookingPolicySnapshot);

@Schema({ _id: false })
export class HotelBookingCancellation {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' }) cancelledBy?: mongoose.Types.ObjectId;
  @Prop({ type: String }) reason?: string;
  @Prop({ type: Number, min: 0, max: 100 }) refundPercentage?: number;
  @Prop({ type: mongoose.Schema.Types.Decimal128 }) refundAmount?: mongoose.Types.Decimal128;
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Refund' }) refundId?: mongoose.Types.ObjectId;
  @Prop({ type: Date }) cancelledAt?: Date;
}
export const HotelBookingCancellationSchema = SchemaFactory.createForClass(HotelBookingCancellation);

@Schema({ collection: 'hotelBookings', timestamps: true, toJSON: { transform: jsonTransform, versionKey: false } })
export class HotelBooking {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  userId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: mongoose.Types.ObjectId;

  // Generated only after successful payment (unique, sparse index below).
  @Prop({ type: String })
  bookingReference?: string;

  @Prop({ type: Date, required: true }) checkInDate!: Date;
  @Prop({ type: Date, required: true }) checkOutDate!: Date;

  @Prop({ type: [RoomBookingSnapshotSchema], required: true })
  roomsSnapshot!: RoomBookingSnapshot[];

  @Prop({ type: Number, required: true, min: 1, validate: Number.isInteger }) adultCount!: number;
  @Prop({ type: Number, required: true, min: 0, validate: Number.isInteger }) childCount!: number;

  @Prop({ type: mongoose.Schema.Types.Decimal128, required: true }) totalPrice!: mongoose.Types.Decimal128;
  @Prop({ type: String, required: true }) currency!: string;

  @Prop({ type: String, enum: Object.values(HotelBookingStatus), required: true })
  status!: HotelBookingStatus;

  @Prop({ type: Date }) holdExpiresAt?: Date;

  @Prop({ type: HotelBookingPolicySnapshotSchema, required: true })
  policySnapshot!: HotelBookingPolicySnapshot;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'PolicyAcceptance' }) policyAcceptanceId?: mongoose.Types.ObjectId;
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }) paymentId?: mongoose.Types.ObjectId;

  @Prop({ type: HotelBookingCancellationSchema }) cancellation?: HotelBookingCancellation;

  @Prop({ type: Date }) confirmedAt?: Date;
  @Prop({ type: Date }) completedAt?: Date;
  @Prop({ type: Date }) expiredAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);
HotelBookingSchema.index({ userId: 1, status: 1 });
HotelBookingSchema.index({ hotelId: 1, status: 1 });
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });
HotelBookingSchema.index({ bookingReference: 1 }, { unique: true, sparse: true });
HotelBookingSchema.index({ 'roomsSnapshot.roomId': 1, checkInDate: 1, checkOutDate: 1 });

HotelBookingSchema.pre('validate', function () {
  if (this.checkInDate && this.checkOutDate && this.checkOutDate <= this.checkInDate) {
    this.invalidate('checkOutDate', 'checkOutDate must be later than checkInDate');
  }
  if (!this.roomsSnapshot?.length) this.invalidate('roomsSnapshot', 'At least one room is required');
  if (this.status === HotelBookingStatus.PENDING_PAYMENT && !this.holdExpiresAt) {
    this.invalidate('holdExpiresAt', 'holdExpiresAt is required while PENDING_PAYMENT');
  }
});
