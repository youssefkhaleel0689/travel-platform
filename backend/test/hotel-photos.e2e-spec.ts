// Hotel photos (HTL-01, GEN-08) through the shared MediaService, against the
// real app and the shared database. It creates one hotel, its moderator
// assignment and two test_c2_ moderators; afterAll removes them, the photos'
// media rows and their files.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role } from './../src/common/auth/auth.enums';
import { HotelModeratorAssignment } from './../src/hotels/schemas/hotel-moderator-assignment.schema';
import { Hotel } from './../src/hotels/schemas/hotel.schema';
import { MediaTargetType } from './../src/media/media.constants';
import { MediaService } from './../src/media/media.service';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

// A PNG signature plus a few bytes: enough for the check on the bytes.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
// Named .png but not a PNG.
const TEXT = Buffer.from('plain text, not an image');

describe('Hotel photos through MediaService (e2e, shared database)', () => {
  let app: INestApplication<App>;
  let hotelModel: Model<Hotel>;
  let assignmentModel: Model<HotelModeratorAssignment>;
  const userIds: string[] = [];
  let moderator: SignedInUser;
  let otherModerator: SignedInUser;
  let hotelId: string;

  const http = () => request(app.getHttpServer());
  const photos = () => `/api/hotels/${hotelId}/photos`;

  function upload(as: SignedInUser, file: Buffer, name = 'room.png') {
    return http()
      .post(photos())
      .set('Cookie', as.cookie)
      .attach('file', file, { filename: name, contentType: 'image/png' });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    hotelModel = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    assignmentModel = app.get<Model<HotelModeratorAssignment>>(
      getModelToken(HotelModeratorAssignment.name),
    );

    moderator = await createSignedInUser(app, {
      label: 'photo-mod',
      role: Role.HOTEL_MODERATOR,
    });
    otherModerator = await createSignedInUser(app, {
      label: 'photo-other-mod',
      role: Role.HOTEL_MODERATOR,
    });
    userIds.push(moderator.userId, otherModerator.userId);

    const hotel = await hotelModel.create({
      name: 'test_c2_photos hotel',
      address: '1 Test Street',
      cityId: 'cairo',
      countryId: 'EG',
      starClass: 3,
      createdBy: new Types.ObjectId(moderator.userId),
    });
    hotelId = hotel._id.toString();
    await assignmentModel.create({
      hotelId: hotel._id,
      moderatorId: new Types.ObjectId(moderator.userId),
    });
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    await app
      .get(MediaService)
      .removeAllForTarget(MediaTargetType.HOTEL, hotelId);
    await assignmentModel
      .deleteMany({ hotelId: new Types.ObjectId(hotelId) })
      .exec();
    await hotelModel.deleteMany({ _id: hotelId }).exec();
    await deleteTestUsers(app, userIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it(
    'stores a photo, lists it on the hotel and serves it publicly',
    async () => {
      const res = await upload(moderator, PNG).expect(201);
      const body = res.body as {
        photos: { id: string; url: string; mimeType: string }[];
      };
      expect(body.photos).toHaveLength(1);
      const [photo] = body.photos;
      expect(photo).toMatchObject({
        url: `/api/hotels/${hotelId}/photos/${photo.id}`,
        mimeType: 'image/png',
      });

      // Kept by MediaService: one media row for the hotel, same id.
      const stored = await app
        .get(MediaService)
        .listForTarget(MediaTargetType.HOTEL, hotelId);
      expect(stored.map((image) => image.id)).toEqual([photo.id]);

      const served = await http()
        .get(photo.url)
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
    },
    SLOW_MS,
  );

  it(
    'refuses a file that is not a JPG or PNG, whatever its name says',
    async () => {
      const res = await upload(moderator, TEXT, 'fake.png').expect(400);
      expect((res.body as { code: string }).code).toBe('INVALID_FILE_TYPE');
    },
    SLOW_MS,
  );

  it(
    'refuses a moderator of another hotel',
    async () => {
      const res = await upload(otherModerator, PNG).expect(403);
      expect((res.body as { code: string }).code).toBe('HOTEL_NOT_ASSIGNED');
    },
    SLOW_MS,
  );

  it(
    'keeps at most 5 photos per hotel',
    async () => {
      const hotel = await hotelModel.findById(hotelId).lean().exec();
      for (let i = hotel?.photos.length ?? 0; i < 5; i++) {
        await upload(moderator, PNG).expect(201);
      }
      const res = await upload(moderator, PNG).expect(409);
      expect((res.body as { code: string }).code).toBe('PHOTO_LIMIT_REACHED');
      const stored = await app
        .get(MediaService)
        .listForTarget(MediaTargetType.HOTEL, hotelId);
      expect(stored).toHaveLength(5);
    },
    SLOW_MS,
  );

  it(
    'removes a photo: off the hotel, out of the media store, no longer served',
    async () => {
      const hotel = await hotelModel.findById(hotelId).lean().exec();
      const photoId = hotel!.photos[0]._id.toString();

      const res = await http()
        .delete(`${photos()}/${photoId}`)
        .set('Cookie', moderator.cookie)
        .expect(200);
      const ids = (res.body as { photos: { id: string }[] }).photos.map(
        (photo) => photo.id,
      );
      expect(ids).not.toContain(photoId);

      const stored = await app
        .get(MediaService)
        .listForTarget(MediaTargetType.HOTEL, hotelId);
      expect(stored.map((image) => image.id)).not.toContain(photoId);
      const gone = await http().get(`${photos()}/${photoId}`).expect(404);
      expect((gone.body as { code: string }).code).toBe('PHOTO_NOT_FOUND');
    },
    SLOW_MS,
  );
});
