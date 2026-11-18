import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  MODERATION_STATES,
  ModerationState,
} from '../../common/moderation/moderation-state';
import { COMMENT_MAX_LENGTH } from '../blog.constants';

export type CommentDocument = HydratedDocument<Comment>;

// A comment on a post (schema section 2.7, BLG-05, BLG-07). Non-empty, at
// most 500 characters, listed in chronological order.
@Schema({ collection: 'comments', timestamps: true })
export class Comment {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: COMMENT_MAX_LENGTH,
  })
  body: string;

  /** Set when the author edits the text (BLG-07); moderation does not touch it. */
  @Prop({ type: Date, default: null })
  editedAt: Date | null;

  @Prop({
    type: String,
    enum: MODERATION_STATES,
    default: ModerationState.VISIBLE,
    required: true,
  })
  moderationState: ModerationState;

  @Prop({ type: Date, default: null })
  hiddenAt: Date | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  hiddenBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  deletedBy: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);

// The post page lists a post's comments oldest first.
CommentSchema.index({ postId: 1, createdAt: 1 });
