import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AirlineModeratorAssignmentDocument =
  HydratedDocument<AirlineModeratorAssignment>;

// The ONLY place that links an airline moderator to an airline (schema section 2.2).
// The link is never copied onto users. Checked on every airline read and write (ACC-11).
@Schema({
  collection: 'airlineModeratorAssignment',
  versionKey: false,
  timestamps: false,
})
export class AirlineModeratorAssignment {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  moderatorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  airlineId: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  assignedAt: Date;
}

export const AirlineModeratorAssignmentSchema = SchemaFactory.createForClass(
  AirlineModeratorAssignment,
);

// A moderator manages exactly one airline.
AirlineModeratorAssignmentSchema.index({ moderatorId: 1 }, { unique: true });
AirlineModeratorAssignmentSchema.index({ airlineId: 1 });
