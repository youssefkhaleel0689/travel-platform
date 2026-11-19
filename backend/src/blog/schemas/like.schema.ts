import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type LikeDocument = HydratedDocument<Like>;

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

// One like per user per post (BLG-06), even on a double click.
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
