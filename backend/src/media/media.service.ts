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

export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

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
  urlFor: (imageId: string) => string;
}

export interface ImageFile {
  path: string;
  mimeType: ImageMimeType;
  sizeBytes: number;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const DUPLICATE_KEY = 11000;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly uploadsRoot: string;

  constructor(
    @InjectModel(MediaMetadata.name)
    private readonly mediaModel: Model<MediaMetadata>,
    config: ConfigService,
  ) {
    this.uploadsRoot = resolve(config.get<string>('UPLOADS_DIR') || 'uploads');
  }

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
    const current = await this.mediaModel
      .countDocuments({ targetType: input.targetType, targetId })
      .exec();
    if (current >= limit) {
      throw imageLimitReached(input.targetType, limit);
    }

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
    // Take the first free slot; a duplicate key means another upload got it first.
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
      }
    }
    await this.deleteFile(storageKey);
    throw imageLimitReached(input.targetType, limit);
  }

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

  async removeFromTarget(
    targetType: MediaTargetType,
    targetId: string,
    imageId: string,
  ): Promise<void> {
    const row = await this.findForTarget(targetType, targetId, imageId);
    const result = await this.mediaModel.deleteOne({ _id: row._id }).exec();
    if (result.deletedCount === 0) {
      throw imageNotFound();
    }
    await this.deleteFile(row.storageKey);
  }

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
      .select('_id storageKey')
      .lean<{ _id: Types.ObjectId; storageKey: string }[]>()
      .exec();
    if (rows.length === 0) {
      return;
    }
    // Delete only the rows read above: an image stored in between keeps both
    // its row and its file (deleting by the filter would orphan the file).
    await this.mediaModel
      .deleteMany({ _id: { $in: rows.map((row) => row._id) } })
      .exec();
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

  // Never let a stored key point outside the uploads folder.
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
      if ((error as { code?: string }).code !== 'ENOENT') {
        this.logger.warn(`Could not delete stored image ${storageKey}`);
      }
    }
  }
}

function toStoredImage(
  row: Pick<MediaMetadata, 'url' | 'mimeType' | 'sizeBytes' | 'uploadedAt'> & {
    _id: Types.ObjectId;
  },
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

export function imageLimitMessage(label: string, limit: number): string {
  const article = /^[aeiou]/i.test(label) ? 'An' : 'A';
  return limit === 1
    ? `${article} ${label} can have only 1 image`
    : `${article} ${label} can have at most ${limit} images`;
}
