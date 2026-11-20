// GEN-08 limits, shared by every module that stores images.
export enum MediaTargetType {
  POST = 'POST',
  ACTIVITY = 'ACTIVITY',
  HOTEL = 'HOTEL',
  AIRLINE = 'AIRLINE',
}

export const MEDIA_TARGET_TYPES = Object.values(MediaTargetType);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

export const IMAGE_UPLOAD_FIELD = 'file';
