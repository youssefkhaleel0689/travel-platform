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

/**
 * A blog post (schema section 2.7, BLG-01 to BLG-10).
 *
 * likeCount and commentCount are kept in step with the likes and comments
 * collections inside the same transaction as the change, so interactionScore
 * (their sum) can be sorted on with an index instead of being counted per
 * search (BLG-09). commentCount counts VISIBLE comments only: a comment an
 * admin hid stops counting until it is restored.
 *
 * Images are not embedded: the mediaMetadata registry (GEN-08) is the one
 * place that says which images a post has.
 */
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

  /** Normalised (lower case, unique); see tags.ts. */
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

  /** likeCount + commentCount (BLG-09 ranking). */
  @Prop({ type: Number, default: 0, min: 0 })
  interactionScore: number;

  /** First time the post was published; null while it has never been. */
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

// BLG-09 search: public posts by score, newest first.
PostSchema.index({
  status: 1,
  moderationState: 1,
  interactionScore: -1,
  publishedAt: -1,
});
// BLG-02 browse and BLG-12 author page: public posts newest first.
PostSchema.index({ status: 1, moderationState: 1, publishedAt: -1 });
// BLG-08 tag pages (multikey).
PostSchema.index({ tags: 1, publishedAt: -1 });
// BLG-03 "my posts".
PostSchema.index({ authorId: 1, createdAt: -1 });
