import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Hotel } from './hotel.schema';

export type HotelModeratorAssignmentDocument =
  HydratedDocument<HotelModeratorAssignment>;

// Collection "hotelModeratorAssignment" (schema section 2.2, owner B1).
// The single source of truth for the moderator-hotel link: it is not copied
// onto users. One hotel per Hotel Moderator (unique moderatorId). Checked on
// every read and write of a moderator (ACC-11, HTL-01).
@Schema({
  collection: 'hotelModeratorAssignment',
  versionKey: false,
  timestamps: false,
})
export class HotelModeratorAssignment {
  // users._id of an account with role HOTEL_MODERATOR.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  moderatorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Hotel.name, required: true })
  hotelId: Types.ObjectId;

  @Prop({ type: Date, required: true, default: () => new Date() })
  assignedAt: Date;
}

export const HotelModeratorAssignmentSchema = SchemaFactory.createForClass(
  HotelModeratorAssignment,
);

// One hotel per moderator.
HotelModeratorAssignmentSchema.index({ moderatorId: 1 }, { unique: true });
// Lookups by hotel, and the ownership check (moderatorId + hotelId).
HotelModeratorAssignmentSchema.index({ hotelId: 1, moderatorId: 1 });
