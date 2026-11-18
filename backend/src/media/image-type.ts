import type { ImageMimeType } from './media.constants';

// The first bytes of every PNG and JPEG file. A client chooses the
// Content-Type and the file name it sends, so neither can be trusted to say
// what the bytes really are: a script renamed to photo.png would pass a check
// on either. The file's own signature is what decides (GEN-08).
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(buffer: Buffer, signature: number[]): boolean {
  return (
    buffer.length >= signature.length &&
    signature.every((byte, index) => buffer[index] === byte)
  );
}

/** The real image type of the bytes, or null when they are not JPG or PNG. */
export function detectImageType(buffer: Buffer): ImageMimeType | null {
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (startsWith(buffer, JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }
  return null;
}
