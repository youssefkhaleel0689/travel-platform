import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MEDIA_TARGET_TYPES,
  MediaTargetType,
} from '../media.constants';
// A type alias used on a decorated property must be a type-only import while
// isolatedModules and emitDecoratorMetadata are both on.
import type { ImageMimeType } from '../media.constants';

export type MediaMetadataDocument = HydratedDocument<MediaMetadata>;

// One stored image (schema section 2.7, mediaMetadata). The bytes live on the
// server's disk under UPLOADS_DIR; this row is the registry that says which
// file belongs to which post, activity, hotel or airline, and is the only
// place the blog reads its images from.
@Schema({ collection: 'mediaMetadata', versionKey: false })
export class MediaMetadata {
  /** Who uploaded it. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: MEDIA_TARGET_TYPES })
  targetType: MediaTargetType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  targetId: Types.ObjectId;

  /**
   * Position 0..limit-1 within the target. The unique index on
   * (targetType, targetId, slot) is what enforces "at most 5 per post" even
   * when two uploads arrive at the same moment: there are only five slots, so
   * a sixth insert can never succeed.
   */
  @Prop({ type: Number, required: true, min: 0 })
  slot: number;

  /** Where clients fetch the image (GEN-08: served by URL). */
  @Prop({ type: String, required: true })
  url: string;

  /** Path relative to UPLOADS_DIR. Never sent to clients. */
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
