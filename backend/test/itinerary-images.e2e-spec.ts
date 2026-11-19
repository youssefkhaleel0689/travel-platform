// Activity images (ITN-12, under the shared upload rule GEN-08) end to end
// against the shared database. It writes: test_c2_ accounts made by the shared
// helper, their itineraries, and the images it uploads. Every image is removed
// through the API (deleting the activity, the day or the itinerary), and
// afterAll removes whatever is left, by owner and by activity id.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Itinerary } from './../src/itineraries/schemas/itinerary.schema';
import { MediaTargetType } from './../src/media/media.constants';
import { MediaService } from './../src/media/media.service';
import { MediaMetadata } from './../src/media/schemas/media-metadata.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 60_000;

// A real 1x1 PNG, so the media store's byte check accepts it.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Activity images (e2e, ITN-12)', () => {
  let app: INestApplication<App>;
  let itineraryModel: Model<Itinerary>;
  let mediaModel: Model<MediaMetadata>;
  const createdUserIds: string[] = [];
  const activityIds: string[] = [];
  let owner: SignedInUser;
  let other: SignedInUser;

  const http = () => request(app.getHttpServer());
  const upload = (activityId: string, cookie: string[], file = PNG) =>
    http()
      .post(`/api/activities/${activityId}/images`)
      .set('Cookie', cookie)
      .attach('file', file, 'photo.png');

  async function newItineraryWithActivity() {
    const created = await http()
      .post('/api/itineraries')
      .set('Cookie', owner.cookie)
      .send({ title: 'E2E images', countries: ['FR'], startDate: '2027-03-10' })
      .expect(201);
    const id = created.body.id as string;
    const withDay = await http()
      .post(`/api/itineraries/${id}/days`)
      .set('Cookie', owner.cookie)
      .send({ city: 'paris' })
      .expect(201);
    const dayId = withDay.body.days[0].id as string;
    const activity = await http()
      .post(`/api/itineraries/${id}/days/${dayId}/activities`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Louvre' })
      .expect(201);
    activityIds.push(activity.body.id as string);
    return { id, dayId, activityId: activity.body.id as string };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    itineraryModel = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    mediaModel = app.get<Model<MediaMetadata>>(
      getModelToken(MediaMetadata.name),
    );
    owner = await createSignedInUser(app, { label: 'itn_img_owner' });
    other = await createSignedInUser(app, { label: 'itn_img_other' });
    createdUserIds.push(owner.userId, other.userId);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    if (app) {
      const media = app.get(MediaService);
      for (const activityId of activityIds) {
        await media.removeAllForTarget(MediaTargetType.ACTIVITY, activityId);
      }
    }
    if (itineraryModel && createdUserIds.length > 0) {
      await itineraryModel
        .deleteMany({
          userId: { $in: createdUserIds.map((id) => new Types.ObjectId(id)) },
        })
        .exec();
    }
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it(
    'attaches, lists, serves and removes images, only for the owner',
    async () => {
      const { id, activityId } = await newItineraryWithActivity();

      // A guest and another account cannot upload.
      await http()
        .post(`/api/activities/${activityId}/images`)
        .attach('file', PNG, 'photo.png')
        .expect(401);
      await upload(activityId, other.cookie)
        .expect(404)
        .expect((res) => expect(res.body.code).toBe('ACTIVITY_NOT_FOUND'));

      // The shared upload rules apply (GEN-08).
      await upload(activityId, owner.cookie, Buffer.from('not an image'))
        .expect(400)
        .expect((res) => expect(res.body.code).toBe('INVALID_FILE_TYPE'));
      await http()
        .post(`/api/activities/${activityId}/images`)
        .set('Cookie', owner.cookie)
        .expect(400)
        .expect((res) => expect(res.body.code).toBe('FILE_REQUIRED'));

      const first = await upload(activityId, owner.cookie).expect(201);
      expect(first.body).toMatchObject({
        url: `/api/activities/${activityId}/images/${first.body.id}`,
        mimeType: 'image/png',
        sizeBytes: PNG.length,
      });
      const imageUrl = first.body.url as string;

      // Listed on the activity in the itinerary view.
      const view = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(view.body.days[0].activities[0].images).toEqual([
        expect.objectContaining({ id: first.body.id, url: imageUrl }),
      ]);

      // Private itinerary: the owner sees the file, a guest and another account get 404.
      const file = await http()
        .get(imageUrl)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      expect(Buffer.from(file.body as Buffer).equals(PNG)).toBe(true);
      await http().get(imageUrl).expect(404);
      await http().get(imageUrl).set('Cookie', other.cookie).expect(404);

      // Public itinerary: anyone may see it, including on the public view.
      await http()
        .patch(`/api/itineraries/${id}/visibility`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'public' })
        .expect(200);
      await http().get(imageUrl).expect(200);
      const publicView = await http()
        .get(`/api/itineraries/public/${id}`)
        .expect(200);
      expect(publicView.body.days[0].activities[0].images).toHaveLength(1);

      // At most 5 per activity.
      for (let i = 0; i < 4; i++) {
        await upload(activityId, owner.cookie).expect(201);
      }
      await upload(activityId, owner.cookie)
        .expect(409)
        .expect((res) => expect(res.body.code).toBe('IMAGE_LIMIT_REACHED'));

      // Only the owner removes, and a removed image is gone everywhere.
      await http().delete(imageUrl).set('Cookie', other.cookie).expect(404);
      await http().delete(imageUrl).set('Cookie', owner.cookie).expect(204);
      await http().delete(imageUrl).set('Cookie', owner.cookie).expect(404);
      await http().get(imageUrl).expect(404);
      const after = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(after.body.days[0].activities[0].images).toHaveLength(4);
      // Space again for one more.
      await upload(activityId, owner.cookie).expect(201);
    },
    SLOW_MS,
  );

  it(
    'removes stored images with the activity, the day or the itinerary, and never clones them',
    async () => {
      const count = (activityId: string) =>
        mediaModel
          .countDocuments({
            targetType: MediaTargetType.ACTIVITY,
            targetId: new Types.ObjectId(activityId),
          })
          .exec();

      // Deleting the activity.
      const a = await newItineraryWithActivity();
      await upload(a.activityId, owner.cookie).expect(201);
      expect(await count(a.activityId)).toBe(1);
      await http()
        .delete(`/api/activities/${a.activityId}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      expect(await count(a.activityId)).toBe(0);

      // Deleting the day.
      const b = await newItineraryWithActivity();
      await upload(b.activityId, owner.cookie).expect(201);
      await http()
        .delete(`/api/itineraries/${b.id}/days/${b.dayId}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(await count(b.activityId)).toBe(0);

      // A clone is independent: it starts without images, and the original
      // keeps its own when the clone is deleted.
      const c = await newItineraryWithActivity();
      await upload(c.activityId, owner.cookie).expect(201);
      await http()
        .patch(`/api/itineraries/${c.id}/visibility`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'public' })
        .expect(200);
      const clone = await http()
        .post(`/api/itineraries/${c.id}/clone`)
        .set('Cookie', other.cookie)
        .expect(201);
      expect(clone.body.days[0].activities[0].images).toEqual([]);
      activityIds.push(clone.body.days[0].activities[0].id as string);
      await http()
        .delete(`/api/itineraries/${clone.body.id}`)
        .set('Cookie', other.cookie)
        .expect(204);
      expect(await count(c.activityId)).toBe(1);

      // Deleting the itinerary.
      await http()
        .delete(`/api/itineraries/${c.id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      expect(await count(c.activityId)).toBe(0);
    },
    SLOW_MS,
  );
});
