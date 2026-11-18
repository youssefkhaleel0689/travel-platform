// GEN-08: the one image-upload rule every module shares. JPG or PNG only, at
// most 5 MB each, at most 5 images per post, activity or hotel and exactly one
// logo per airline. Kept in one place so the blog (BLG-10), itineraries
// (ITN-12), hotels (HTL-01) and airlines (FLT-01) can never drift apart.

/** What an image belongs to (schema section 6, mediaMetadata.targetType). */
export enum MediaTargetType {
  POST = 'POST',
  ACTIVITY = 'ACTIVITY',
  HOTEL = 'HOTEL',
  AIRLINE = 'AIRLINE',
}

export const MEDIA_TARGET_TYPES = Object.values(MediaTargetType);

/** 5 MB, as the requirement states it (5 x 1024 x 1024 bytes). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** How many images one target may hold at the same time. */
export const MAX_IMAGES_PER_TARGET: Readonly<Record<MediaTargetType, number>> =
  {
    [MediaTargetType.POST]: 5,
    [MediaTargetType.ACTIVITY]: 5,
    [MediaTargetType.HOTEL]: 5,
    [MediaTargetType.AIRLINE]: 1,
  };

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const IMAGE_EXTENSION: Readonly<Record<ImageMimeType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** The multipart field every upload endpoint reads the file from. */
export const IMAGE_UPLOAD_FIELD = 'file';
