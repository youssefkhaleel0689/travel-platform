import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  MODERATION_STATES,
  ModerationState,
} from '../../common/moderation/moderation-state';
import {
  MAX_TAGS_PER_POST,
  POST_BODY_MAX_LENGTH,
  POST_STATUSES,
  POST_TITLE_MAX_LENGTH,
  PostStatus,
  TAG_MAX_LENGTH,
} from '../blog.constants';

export type PostDocument = HydratedDocument<Post>;

@Schema({ collection: 'posts', timestamps: true })
export class Post {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: POST_TITLE_MAX_LENGTH,
  })
  title: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: POST_BODY_MAX_LENGTH,
  })
  body: string;

  @Prop({ type: String, required: true, enum: POST_STATUSES })
  status: PostStatus;

  @Prop({
    type: [{ type: String, maxlength: TAG_MAX_LENGTH }],
    default: [],
    validate: {
      validator: (tags: string[]) => tags.length <= MAX_TAGS_PER_POST,
      message: `A post can have at most ${MAX_TAGS_PER_POST} tags`,
    },
  })
  tags: string[];

  @Prop({ type: Number, default: 0, min: 0 })
  likeCount: number;

  @Prop({ type: Number, default: 0, min: 0 })
  commentCount: number;

  // likeCount + commentCount, kept on the post so search can sort on it (BLG-09).
  @Prop({ type: Number, default: 0, min: 0 })
  interactionScore: number;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

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

export const PostSchema = SchemaFactory.createForClass(Post);

PostSchema.index({
  status: 1,
  moderationState: 1,
  interactionScore: -1,
  publishedAt: -1,
});
PostSchema.index({ status: 1, moderationState: 1, publishedAt: -1 });
PostSchema.index({ tags: 1, publishedAt: -1 });
PostSchema.index({ authorId: 1, createdAt: -1 });
