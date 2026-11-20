import { BadRequestException, HttpException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { MediaService, StoredImage } from '../../media/media.service';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import type { AirlineActor } from './airline-actor';
import { AirlineLogoService } from './airline-logo.service';

const AIRLINE_ID = new Types.ObjectId();
const AIRLINE = AIRLINE_ID.toString();
const OTHER_AIRLINE_ID = new Types.ObjectId();
const URL = `/api/airlines/${AIRLINE}/logo`;

const admin: AirlineActor = {
  userId: new Types.ObjectId().toString(),
  role: 'ADMIN',
};
const moderator: AirlineActor = {
  userId: new Types.ObjectId().toString(),
  role: 'AIRLINE_MODERATOR',
};
const traveller: AirlineActor = {
  userId: new Types.ObjectId().toString(),
  role: 'USER',
};

const FILE = {
  originalname: 'logo.png',
  mimetype: 'image/png',
  size: 3,
  buffer: Buffer.from([1, 2, 3]),
};

const STORED: StoredImage = {
  id: new Types.ObjectId().toString(),
  url: URL,
  mimeType: 'image/png',
  sizeBytes: 3,
  uploadedAt: new Date('2026-11-20T10:00:00.000Z'),
};

function query<R>(result: R) {
  const chain = {
    select: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

function limitReached() {
  return new ConflictException({
    code: 'IMAGE_LIMIT_REACHED',
    message: 'An airline can have only 1 image',
  });
}

function setup(options: {
  status?: AirlineStatus | null; // null: no such airline
  assignedTo?: Types.ObjectId | null;
  storeResults?: Array<StoredImage | Error>;
  existing?: StoredImage[];
}) {
  const status =
    options.status === undefined ? AirlineStatus.ACTIVE : options.status;
  const assignedTo = options.assignedTo ?? null;
  const results = [...(options.storeResults ?? [STORED])];

  const airlineModel = {
    exists: jest.fn(() => query(status ? { _id: AIRLINE_ID } : null)),
    findById: jest.fn(() => query(status ? { status } : null)),
    updateOne: jest.fn(() => query({})),
  };
  const assignmentModel = {
    exists: jest.fn((filter: { airlineId: Types.ObjectId }) =>
      query(
        assignedTo && assignedTo.equals(filter.airlineId) ? { _id: 1 } : null,
      ),
    ),
  };
  const media = {
    storeImage: jest.fn(() => {
      const next = results.shift();
      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve(next);
    }),
    removeAllForTarget: jest.fn(() => Promise.resolve()),
    listForTarget: jest.fn(() => Promise.resolve(options.existing ?? [])),
    openForTarget: jest.fn(() =>
      Promise.resolve({
        path: '/tmp/x.png',
        mimeType: 'image/png',
        sizeBytes: 3,
      }),
    ),
  };
  const service = new AirlineLogoService(
    airlineModel as unknown as Model<Airline>,
    assignmentModel as unknown as Model<AirlineModeratorAssignment>,
    media as unknown as MediaService,
  );
  return { service, airlineModel, media };
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

function codeOf(error: HttpException): string {
  return (error.getResponse() as { code: string }).code;
}

describe('AirlineLogoService.setLogo (FLT-01, GEN-08)', () => {
  it('stores the logo for the assigned moderator and sets airline.logo', async () => {
    const { service, airlineModel, media } = setup({ assignedTo: AIRLINE_ID });
    const result = await service.setLogo(AIRLINE, moderator, FILE);

    expect(result).toEqual(STORED);
    expect(media.storeImage).toHaveBeenCalledTimes(1);
    expect(media.removeAllForTarget).not.toHaveBeenCalled();
    expect(airlineModel.updateOne).toHaveBeenCalledWith(
      { _id: AIRLINE_ID },
      { $set: { logo: URL } },
    );
  });

  it('lets an admin set the logo of any airline', async () => {
    const { service } = setup({});
    await expect(service.setLogo(AIRLINE, admin, FILE)).resolves.toEqual(
      STORED,
    );
  });

  it('replaces an existing logo: removes the old one, then stores the new one', async () => {
    const { service, media } = setup({
      assignedTo: AIRLINE_ID,
      storeResults: [limitReached(), STORED],
    });
    await service.setLogo(AIRLINE, moderator, FILE);

    expect(media.storeImage).toHaveBeenCalledTimes(2);
    expect(media.removeAllForTarget).toHaveBeenCalledWith('AIRLINE', AIRLINE);
  });

  it('two uploads at once: retries when the other one took the slot, so the last one wins', async () => {
    const { service, media, airlineModel } = setup({
      assignedTo: AIRLINE_ID,
      storeResults: [limitReached(), limitReached(), STORED],
    });

    await expect(service.setLogo(AIRLINE, moderator, FILE)).resolves.toEqual(
      STORED,
    );
    expect(media.storeImage).toHaveBeenCalledTimes(3);
    expect(media.removeAllForTarget).toHaveBeenCalledTimes(2);
    expect(airlineModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it('gives up with 409 CONCURRENT_UPDATE after three taken slots in a row', async () => {
    const { service, media, airlineModel } = setup({
      assignedTo: AIRLINE_ID,
      storeResults: [limitReached(), limitReached(), limitReached()],
    });

    const error = await failure(service.setLogo(AIRLINE, moderator, FILE));

    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('CONCURRENT_UPDATE');
    expect(media.storeImage).toHaveBeenCalledTimes(3);
    expect(airlineModel.updateOne).not.toHaveBeenCalled();
  });

  it('keeps the old logo when the file is rejected', async () => {
    const bad = new BadRequestException({
      code: 'INVALID_FILE_TYPE',
      message: 'x',
    });
    const { service, media, airlineModel } = setup({
      assignedTo: AIRLINE_ID,
      storeResults: [bad],
    });
    const error = await failure(service.setLogo(AIRLINE, moderator, FILE));

    expect(codeOf(error)).toBe('INVALID_FILE_TYPE');
    expect(media.removeAllForTarget).not.toHaveBeenCalled();
    expect(airlineModel.updateOne).not.toHaveBeenCalled();
  });

  it('403s a moderator of another airline, one without an airline, and other roles', async () => {
    const other = setup({ assignedTo: OTHER_AIRLINE_ID });
    expect(
      (
        await failure(other.service.setLogo(AIRLINE, moderator, FILE))
      ).getStatus(),
    ).toBe(403);
    const none = setup({});
    expect(
      (
        await failure(none.service.setLogo(AIRLINE, moderator, FILE))
      ).getStatus(),
    ).toBe(403);
    const user = setup({});
    expect(
      (
        await failure(user.service.setLogo(AIRLINE, traveller, FILE))
      ).getStatus(),
    ).toBe(403);
    expect(other.media.storeImage).not.toHaveBeenCalled();
  });

  it('404s an unknown or malformed airline id', async () => {
    const missing = setup({ status: null });
    expect(
      codeOf(await failure(missing.service.setLogo(AIRLINE, admin, FILE))),
    ).toBe('AIRLINE_NOT_FOUND');
    const bad = setup({});
    expect(
      codeOf(await failure(bad.service.setLogo('nope', admin, FILE))),
    ).toBe('AIRLINE_NOT_FOUND');
  });
});

describe('AirlineLogoService.openLogo (FLT-01, GEN-08)', () => {
  it('serves the logo of an ACTIVE airline to a guest', async () => {
    const { service, media } = setup({ existing: [STORED] });
    const file = await service.openLogo(AIRLINE, undefined);
    expect(file.mimeType).toBe('image/png');
    expect(media.openForTarget).toHaveBeenCalledWith(
      'AIRLINE',
      AIRLINE,
      STORED.id,
    );
  });

  it('404s LOGO_NOT_FOUND when there is none', async () => {
    const { service } = setup({ existing: [] });
    expect(codeOf(await failure(service.openLogo(AIRLINE, undefined)))).toBe(
      'LOGO_NOT_FOUND',
    );
  });

  it('hides a DEACTIVATED airline from guests but not from its moderator', async () => {
    const guest = setup({
      status: AirlineStatus.DEACTIVATED,
      existing: [STORED],
    });
    expect(
      codeOf(await failure(guest.service.openLogo(AIRLINE, undefined))),
    ).toBe('AIRLINE_NOT_FOUND');
    const mine = setup({
      status: AirlineStatus.DEACTIVATED,
      assignedTo: AIRLINE_ID,
      existing: [STORED],
    });
    await expect(
      mine.service.openLogo(AIRLINE, moderator),
    ).resolves.toBeDefined();
  });

  it('404s a malformed or unknown airline id', async () => {
    const { service } = setup({ status: null });
    expect(codeOf(await failure(service.openLogo('nope', undefined)))).toBe(
      'AIRLINE_NOT_FOUND',
    );
    expect(codeOf(await failure(service.openLogo(AIRLINE, undefined)))).toBe(
      'AIRLINE_NOT_FOUND',
    );
  });
});

describe('AirlineLogoService.removeLogo (FLT-01, GEN-08)', () => {
  it('removes the logo and sets airline.logo to null', async () => {
    const { service, media, airlineModel } = setup({
      assignedTo: AIRLINE_ID,
      existing: [STORED],
    });
    await service.removeLogo(AIRLINE, moderator);

    expect(media.removeAllForTarget).toHaveBeenCalledWith('AIRLINE', AIRLINE);
    expect(airlineModel.updateOne).toHaveBeenCalledWith(
      { _id: AIRLINE_ID },
      { $set: { logo: null } },
    );
  });

  it('404s LOGO_NOT_FOUND when there is nothing to remove', async () => {
    const { service } = setup({ assignedTo: AIRLINE_ID, existing: [] });
    expect(codeOf(await failure(service.removeLogo(AIRLINE, moderator)))).toBe(
      'LOGO_NOT_FOUND',
    );
  });

  it('403s a moderator of another airline', async () => {
    const { service, media } = setup({
      assignedTo: OTHER_AIRLINE_ID,
      existing: [STORED],
    });
    expect(
      (await failure(service.removeLogo(AIRLINE, moderator))).getStatus(),
    ).toBe(403);
    expect(media.removeAllForTarget).not.toHaveBeenCalled();
  });
});
