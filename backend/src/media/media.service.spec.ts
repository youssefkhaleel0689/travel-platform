import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Types } from 'mongoose';
import { MAX_IMAGE_BYTES, MediaTargetType } from './media.constants';
import { MediaService, UploadedImage } from './media.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const OWNER = '6720f1c2a1b2c3d4e5f60701';
const POST = '6720f1c2a1b2c3d4e5f60702';

function file(buffer: Buffer, size = buffer.length): UploadedImage {
  return { originalname: 'a.png', mimetype: 'image/png', size, buffer };
}

function exec<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('MediaService (GEN-08)', () => {
  let root: string;
  let model: {
    countDocuments: jest.Mock;
    create: jest.Mock;
  };
  let service: MediaService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'media-spec-'));
    model = {
      countDocuments: jest.fn().mockReturnValue(exec(0)),
      create: jest.fn(async (doc: Record<string, unknown>) => doc),
    };
    const config = { get: () => root } as unknown as ConfigService;
    service = new MediaService(model as never, config);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const input = (upload: UploadedImage | undefined) => ({
    ownerId: OWNER,
    targetType: MediaTargetType.POST,
    targetId: POST,
    file: upload,
    urlFor: (id: string) => `/api/posts/${POST}/images/${id}`,
  });

  it('stores a PNG on disk, records it in slot 0 and returns its URL', async () => {
    const image = await service.storeImage(input(file(PNG)));

    expect(image.mimeType).toBe('image/png');
    expect(image.sizeBytes).toBe(PNG.length);
    expect(image.url).toBe(`/api/posts/${POST}/images/${image.id}`);
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 0, targetType: MediaTargetType.POST }),
    );
    expect(await readdir(join(root, 'post', POST))).toHaveLength(1);
  });

  it('refuses a missing file with FILE_REQUIRED', async () => {
    await expect(service.storeImage(input(undefined))).rejects.toMatchObject({
      response: { code: 'FILE_REQUIRED' },
    });
  });

  it('refuses bytes that are not JPG or PNG, whatever the client claims', async () => {
    const fake = file(Buffer.from('GIF89a....'));
    await expect(service.storeImage(input(fake))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.storeImage(input(fake))).rejects.toMatchObject({
      response: { code: 'INVALID_FILE_TYPE' },
    });
  });

  it('refuses a file over 5 MB with FILE_TOO_LARGE', async () => {
    const big = file(PNG, MAX_IMAGE_BYTES + 1);
    await expect(service.storeImage(input(big))).rejects.toMatchObject({
      response: { code: 'FILE_TOO_LARGE' },
    });
  });

  it('refuses a sixth image with IMAGE_LIMIT_REACHED before writing anything', async () => {
    model.countDocuments.mockReturnValue(exec(5));
    await expect(service.storeImage(input(file(PNG)))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(model.create).not.toHaveBeenCalled();
  });

  it('moves to the next slot when a parallel upload took the first one', async () => {
    model.create
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }))
      .mockImplementation(async (doc: Record<string, unknown>) => doc);

    await service.storeImage(input(file(PNG)));

    expect(model.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ slot: 1 }),
    );
  });

  it('gives up and deletes the file when every slot is taken', async () => {
    model.create.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    await expect(service.storeImage(input(file(PNG)))).rejects.toMatchObject({
      response: { code: 'IMAGE_LIMIT_REACHED' },
    });
    expect(model.create).toHaveBeenCalledTimes(5);
    expect(await readdir(join(root, 'post', POST))).toHaveLength(0);
  });

  it('allows only one airline logo', async () => {
    model.countDocuments.mockReturnValue(exec(1));
    await expect(
      service.storeImage({
        ...input(file(PNG)),
        targetType: MediaTargetType.AIRLINE,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'IMAGE_LIMIT_REACHED',
        message: 'An airline can have only 1 image',
      },
    });
  });

  it('answers 404 IMAGE_NOT_FOUND for a malformed image id', async () => {
    await expect(
      service.openForTarget(MediaTargetType.POST, POST, 'not-an-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists nothing for a malformed target id without querying', async () => {
    expect(
      await service.listForTarget(MediaTargetType.POST, 'x'),
    ).toEqual([]);
    expect(new Types.ObjectId(POST).toHexString()).toBe(POST);
  });
});
