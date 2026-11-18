import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  CONTENT_TYPES,
  ContentType,
} from '../../common/moderation/content-moderation.port';
import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  REPORT_STATUSES,
  ReportReason,
  ReportStatus,
} from '../report.enums';

export type ReportDocument = HydratedDocument<Report>;

// One user's report of one post, comment, review or itinerary (schema
// section 2.7, GEN-09). Resolved by an admin (GEN-10).
@Schema({ collection: 'reports', timestamps: true })
export class Report {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  reporterId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: CONTENT_TYPES })
  targetType: ContentType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  targetId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: REPORT_REASONS })
  reason: ReportReason;

  @Prop({
    type: String,
    default: null,
    trim: true,
    maxlength: REPORT_DETAILS_MAX_LENGTH,
  })
  details: string | null;

  @Prop({
    type: String,
    required: true,
    enum: REPORT_STATUSES,
    default: ReportStatus.OPEN,
  })
  status: ReportStatus;

  /** The admin who resolved it; null while OPEN. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  reviewerId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);

// "At most once per item" (GEN-09) is this index: a double click cannot
// create two reports, because only one insert can win.
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
// The admin queue: open reports, oldest first.
ReportSchema.index({ status: 1, createdAt: 1 });
// Closing every open report on one item when an admin acts on it.
ReportSchema.index({ targetType: 1, targetId: 1, status: 1 });
