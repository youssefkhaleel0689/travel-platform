import type { ImageMimeType } from './media.constants';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(buffer: Buffer, signature: number[]): boolean {
  return (
    buffer.length >= signature.length &&
    signature.every((byte, index) => buffer[index] === byte)
  );
}

// The client's file name and Content-Type can lie, so the first bytes decide.
export function detectImageType(buffer: Buffer): ImageMimeType | null {
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (startsWith(buffer, JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }
  return null;
}
