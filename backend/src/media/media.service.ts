import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Model, Types } from 'mongoose';
import { detectImageType } from './image-type';
import {
  IMAGE_EXTENSION,
  ImageMimeType,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_TARGET,
  MediaTargetType,
} from './media.constants';
import { MediaMetadata } from './schemas/media-metadata.schema';

/** The parts of a multer memory-storage file this service reads. */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** An image as other modules and their responses see it. */
export interface StoredImage {
  id: string;
  url: string;
  mimeType: ImageMimeType;
  sizeBytes: number;
  uploadedAt: Date;
}

export interface StoreImageInput {
  ownerId: string;
  targetType: MediaTargetType;
  targetId: string;
  file: UploadedImage | undefined;
  /**
   * Builds the public URL from the new image's id. The owning module decides
   * the route, because it is also the module that checks who may see the
   * image before serving it (a draft post's images are not public).
   */
  urlFor: (imageId: string) => string;
}

/** A stored file, ready to stream. */
export interface ImageFile {
  path: string;
  mimeType: ImageMimeType;
  sizeBytes: number;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const DUPLICATE_KEY = 11000;

/**
 * GEN-08: the shared image-upload service. Validates type, size and count,
 * stores the bytes on the server and keeps the mediaMetadata registry.
 *
 * It does not decide who may upload or see an image: the module that owns the
 * target (blog, itineraries, hotels, airlines) checks that first, then calls
 * this service. That keeps every access rule next to the data it protects.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly uploadsRoot: string;

  constructor(
    @InjectModel(MediaMetadata.name)
    private readonly mediaModel: Model<MediaMetadata>,
    config: ConfigService,
  ) {
    // Same variable and default as the hotel photos, so all uploads share one
    // folder on the server.
    this.uploadsRoot = resolve(config.get<string>('UPLOADS_DIR') || 'uploads');
  }

  /**
   * Validates and stores one image for a target.
   *
   * 400 FILE_REQUIRED, INVALID_FILE_TYPE or FILE_TOO_LARGE for a bad file;
   * 409 IMAGE_LIMIT_REACHED when the target already holds its maximum.
   */
  async storeImage(input: StoreImageInput): Promise<StoredImage> {
    const { file } = input;
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'An image file is required',
        errors: [{ field: 'file', messages: ['file is required'] }],
      });
    }
    if (file.buffer.length > MAX_IMAGE_BYTES || file.size > MAX_IMAGE_BYTES) {
      throw fileTooLarge();
    }
    const mimeType = detectImageType(file.buffer);
    if (!mimeType) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'Only JPG and PNG images are accepted',
        errors: [{ field: 'file', messages: ['must be a JPG or PNG image'] }],
      });
    }

    const limit = MAX_IMAGES_PER_TARGET[input.targetType];
    const targetId = new Types.ObjectId(input.targetId);
    // Cheap early answer for the common case; the unique slot index below is
    // what actually guarantees the limit under concurrent uploads.
    const current = await this.mediaModel
      .countDocuments({ targetType: input.targetType, targetId })
      .exec();
    if (current >= limit) {
      throw imageLimitReached(input.targetType, limit);
    }

    // Bytes first, row second: a crash in between leaves an orphan file on
    // disk (harmless), never a row pointing at a file that does not exist.
    const imageId = new Types.ObjectId();
    const storageKey = [
      input.targetType.toLowerCase(),
      input.targetId,
      `${randomUUID()}.${IMAGE_EXTENSION[mimeType]}`,
    ].join('/');
    const path = this.resolveStoragePath(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.buffer);

    const url = input.urlFor(imageId.toHexString());
    for (let slot = 0; slot < limit; slot += 1) {
      try {
        const row = await this.mediaModel.create({
          _id: imageId,
          ownerId: new Types.ObjectId(input.ownerId),
          targetType: input.targetType,
          targetId,
          slot,
          url,
          storageKey,
          mimeType,
          sizeBytes: file.buffer.length,
          uploadedAt: new Date(),
        });
        return toStoredImage(row);
      } catch (error) {
        if ((error as { code?: number }).code !== DUPLICATE_KEY) {
          await this.deleteFile(storageKey);
          throw error;
        }
        // That slot was taken (possibly a moment ago by a parallel upload):
        // try the next one.
      }
    }
    await this.deleteFile(storageKey);
    throw imageLimitReached(input.targetType, limit);
  }

  /** Every image of one target, oldest upload first. */
  async listForTarget(
    targetType: MediaTargetType,
    targetId: string,
  ): Promise<StoredImage[]> {
    if (!OBJECT_ID.test(targetId)) {
      return [];
    }
    const rows = await this.mediaModel
      .find({ targetType, targetId: new Types.ObjectId(targetId) })
      .sort({ uploadedAt: 1, _id: 1 })
      .lean<(MediaMetadata & { _id: Types.ObjectId })[]>()
      .exec();
    return rows.map(toStoredImage);
  }

  /**
   * The file of one image of one target, for streaming. 404 IMAGE_NOT_FOUND
   * when the id is malformed, belongs to another target, or the file is gone.
   */
  async openForTarget(
    targetType: MediaTargetType,
    targetId: string,
    imageId: string,
  ): Promise<ImageFile> {
    const row = await this.findForTarget(targetType, targetId, imageId);
    const path = this.resolveStoragePath(row.storageKey);
    try {
      await stat(path);
    } catch {
      throw imageNotFound();
    }
    return { path, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
  }

  /** Removes one image (row and file) from its target. 404 when it is not there. */
  async removeFromTarget(
    targetType: MediaTargetType,
    targetId: string,
    imageId: string,
  ): Promise<void> {
    const row = await this.findForTarget(targetType, targetId, imageId);
    const result = await this.mediaModel.deleteOne({ _id: row._id }).exec();
    if (result.deletedCount === 0) {
      // Removed by a parallel request between the read and the delete.
      throw imageNotFound();
    }
    await this.deleteFile(row.storageKey);
  }

  /** Removes every image of a target, e.g. when its post is deleted. */
  async removeAllForTarget(
    targetType: MediaTargetType,
    targetId: string,
  ): Promise<void> {
    if (!OBJECT_ID.test(targetId)) {
      return;
    }
    const filter = { targetType, targetId: new Types.ObjectId(targetId) };
    const rows = await this.mediaModel
      .find(filter)
      .select('storageKey')
      .lean<{ storageKey: string }[]>()
      .exec();
    await this.mediaModel.deleteMany(filter).exec();
    await Promise.all(rows.map((row) => this.deleteFile(row.storageKey)));
  }

  private async findForTarget(
    targetType: MediaTargetType,
    targetId: string,
    imageId: string,
  ) {
    if (!OBJECT_ID.test(targetId) || !OBJECT_ID.test(imageId)) {
      throw imageNotFound();
    }
    const row = await this.mediaModel
      .findOne({
        _id: new Types.ObjectId(imageId),
        targetType,
        targetId: new Types.ObjectId(targetId),
      })
      .lean<MediaMetadata & { _id: Types.ObjectId }>()
      .exec();
    if (!row) {
      throw imageNotFound();
    }
    return row;
  }

  // A storage key is built by this service, but resolving it against the root
  // and checking the result stays inside it means a tampered row can never
  // make the server read or delete a file elsewhere.
  private resolveStoragePath(storageKey: string): string {
    const path = resolve(this.uploadsRoot, storageKey);
    if (!path.startsWith(this.uploadsRoot + sep)) {
      throw imageNotFound();
    }
    return path;
  }

  private async deleteFile(storageKey: string): Promise<void> {
    try {
      await unlink(this.resolveStoragePath(storageKey));
    } catch (error) {
      // Already gone is fine; anything else is logged, never thrown, because
      // the row is what clients see and it has already been removed.
      if ((error as { code?: string }).code !== 'ENOENT') {
        this.logger.warn(`Could not delete stored image ${storageKey}`);
      }
    }
  }
}

function toStoredImage(
  row: Pick<
    MediaMetadata,
    'url' | 'mimeType' | 'sizeBytes' | 'uploadedAt'
  > & { _id: Types.ObjectId },
): StoredImage {
  return {
    id: row._id.toHexString(),
    url: row.url,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt,
  };
}

export function fileTooLarge(): BadRequestException {
  return new BadRequestException({
    code: 'FILE_TOO_LARGE',
    message: 'Images must be at most 5 MB',
    errors: [{ field: 'file', messages: ['must be at most 5 MB'] }],
  });
}

function imageLimitReached(
  targetType: MediaTargetType,
  limit: number,
): ConflictException {
  return new ConflictException({
    code: 'IMAGE_LIMIT_REACHED',
    message: imageLimitMessage(targetType.toLowerCase(), limit),
  });
}

function imageNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'IMAGE_NOT_FOUND',
    message: 'Image not found',
  });
}

/** "A post can have at most 5 images", "An airline can have only 1 image". */
export function imageLimitMessage(label: string, limit: number): string {
  const article = /^[aeiou]/i.test(label) ? 'An' : 'A';
  return limit === 1
    ? `${article} ${label} can have only 1 image`
    : `${article} ${label} can have at most ${limit} images`;
}
