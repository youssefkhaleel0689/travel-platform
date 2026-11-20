import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { jsonTransform } from '../../common/mongo';

export type HotelReviewDocument = HydratedDocument<HotelReview>;

// Matches the team schema (moderationStateEnum): VISIBLE | HIDDEN | DELETED. (The original had PENDING.)
export enum ReviewModerationState {
  VISIBLE = 'VISIBLE',
  HIDDEN = 'HIDDEN',
  DELETED = 'DELETED',
}

// HTL-26 (bonus): one moderator reply per review; posting again replaces it.
@Schema({ _id: false })
export class ReviewReply {
  @Prop({ type: String, required: true, maxlength: 1000 }) body!: string;
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  moderatorId!: mongoose.Types.ObjectId;
  @Prop({ type: Date, required: true }) repliedAt!: Date;
}
export const ReviewReplySchema = SchemaFactory.createForClass(ReviewReply);

@Schema({
  collection: 'reviews',
  timestamps: true,
  toJSON: { transform: jsonTransform, versionKey: false },
})
export class HotelReview {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  userId!: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HotelBooking',
    required: true,
  })
  bookingId!: mongoose.Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    max: 5,
    validate: Number.isInteger,
  })
  rating!: number;

  @Prop({ type: String, maxlength: 1000 })
  comment?: string;

  @Prop({
    type: String,
    enum: Object.values(ReviewModerationState),
    default: ReviewModerationState.VISIBLE,
    required: true,
  })
  moderationState!: ReviewModerationState;

  // Moderation fields (GEN-10). Set by the admin / moderation module, never by B2 code.
  @Prop({ type: Date }) hiddenAt?: Date;
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  hiddenBy?: mongoose.Types.ObjectId;
  @Prop({ type: Date }) deletedAt?: Date;
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  deletedBy?: mongoose.Types.ObjectId;

  @Prop({ type: ReviewReplySchema })
  reply?: ReviewReply;

  createdAt!: Date;
  updatedAt!: Date;
}

export const HotelReviewSchema = SchemaFactory.createForClass(HotelReview);
HotelReviewSchema.index({ bookingId: 1 }, { unique: true }); // one review per reservation
HotelReviewSchema.index({ hotelId: 1, moderationState: 1, createdAt: -1 });
