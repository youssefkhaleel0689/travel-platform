import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type LikeDocument = HydratedDocument<Like>;

// One user's like of one post (schema section 2.7, BLG-06). Unliking deletes
// the row.
@Schema({
  collection: 'likes',
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
})
export class Like {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  createdAt: Date;
}

export const LikeSchema = SchemaFactory.createForClass(Like);

// "Once per user" is this index, not a check in code: a double click sends two
// requests that would both pass a read-then-insert check, but only one insert
// can succeed against a unique index.
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
