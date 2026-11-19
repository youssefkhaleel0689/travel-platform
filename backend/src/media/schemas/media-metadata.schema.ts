import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MEDIA_TARGET_TYPES,
  MediaTargetType,
} from '../media.constants';
import type { ImageMimeType } from '../media.constants';

export type MediaMetadataDocument = HydratedDocument<MediaMetadata>;

@Schema({ collection: 'mediaMetadata', versionKey: false })
export class MediaMetadata {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: MEDIA_TARGET_TYPES })
  targetType: MediaTargetType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  targetId: Types.ObjectId;

  // 0..limit-1. The unique index below caps the images per target even when
  // two uploads arrive at the same time.
  @Prop({ type: Number, required: true, min: 0 })
  slot: number;

  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: String, required: true })
  storageKey: string;

  @Prop({ type: String, required: true, enum: IMAGE_MIME_TYPES })
  mimeType: ImageMimeType;

  @Prop({ type: Number, required: true, min: 1, max: MAX_IMAGE_BYTES })
  sizeBytes: number;

  @Prop({ type: Date, required: true, default: () => new Date() })
  uploadedAt: Date;
}

export const MediaMetadataSchema = SchemaFactory.createForClass(MediaMetadata);

MediaMetadataSchema.index(
  { targetType: 1, targetId: 1, slot: 1 },
  { unique: true },
);
