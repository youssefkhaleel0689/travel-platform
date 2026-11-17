import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type HotelModeratorAssignmentDocument =
  HydratedDocument<HotelModeratorAssignment>;

// The ONLY place that links a hotel moderator to a hotel. Same pattern as
// airlineModeratorAssignment (PR #18): singular collection name, a unique
// moderatorId (one hotel per moderator), checked on every moderator request.
@Schema({
  collection: 'hotelModeratorAssignment',
  versionKey: false,
  timestamps: false,
})
export class HotelModeratorAssignment {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  moderatorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  @Prop({ type: Date, required: true, default: () => new Date() })
  assignedAt: Date;
}

export const HotelModeratorAssignmentSchema = SchemaFactory.createForClass(
  HotelModeratorAssignment,
);

HotelModeratorAssignmentSchema.index({ moderatorId: 1 }, { unique: true });
HotelModeratorAssignmentSchema.index({ hotelId: 1, moderatorId: 1 });
