// What a moderation decision or a visibility change takes away, against the
// real app and the shared database. Accounts come from the shared helper
// (test_c2_ emails); the reviews, itineraries and posts this suite creates
// are deleted in afterAll by their owner ids, and its one hotel by id.
//
// - Reviews (GEN-10): the author cannot edit or delete a review an admin has
//   hidden or deleted.
// - BLG-13: a post stops showing its itinerary's id once that itinerary is
//   private or deleted.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Post } from './../src/blog/schemas/post.schema';
import { Role } from './../src/common/auth/auth.enums';
import { Itinerary } from './../src/itineraries/schemas/itinerary.schema';
import { Hotel } from './../src/hotels/schemas/hotel.schema';
import { HotelReview } from './../src/reviews/schemas/hotel-review.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

describe('Moderated and private content (e2e, shared database)', () => {
  let app: INestApplication<App>;
  let reviewModel: Model<HotelReview>;
  let itineraryModel: Model<Itinerary>;
  let postModel: Model<Post>;
  let hotelModel: Model<Hotel>;
  // Editing or deleting a review recalculates its hotel's rating.
  let hotelId: Types.ObjectId;
  const userIds: string[] = [];
  let author: SignedInUser;
  let reader: SignedInUser;
  let admin: SignedInUser;

  const http = () => request(app.getHttpServer());

  // A review written straight to the collection: getting one through the API
  // needs a completed hotel stay, which is not what this suite is about.
  async function visibleReview(): Promise<string> {
    const review = await reviewModel.create({
      hotelId,
      userId: new Types.ObjectId(author.userId),
      bookingId: new Types.ObjectId(),
      rating: 4,
      comment: 'Quiet rooms, friendly staff',
    });
    return review._id.toString();
  }

  async function publicItinerary(): Promise<string> {
    const res = await http()
      .post('/api/itineraries')
      .set('Cookie', author.cookie)
      .send({
        title: 'Luxor in three days',
        countries: ['EG'],
        startDate: '2099-03-10',
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    await setVisibility(id, 'public');
    return id;
  }

  async function setVisibility(id: string, visibility: 'public' | 'private') {
    await http()
      .patch(`/api/itineraries/${id}/visibility`)
      .set('Cookie', author.cookie)
      .send({ visibility })
      .expect(200);
  }

  async function postWith(itineraryId: string): Promise<string> {
    const res = await http()
      .post('/api/posts')
      .set('Cookie', author.cookie)
      .send({
        title: 'Three days in Luxor',
        body: 'We started at Karnak at sunrise.',
        status: 'PUBLISHED',
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    await http()
      .patch(`/api/posts/${id}/itinerary`)
      .set('Cookie', author.cookie)
      .send({ itineraryId })
      .expect(200);
    return id;
  }

  async function shownItinerary(postId: string, as?: SignedInUser) {
    const req = http().get(`/api/posts/${postId}`);
    if (as) req.set('Cookie', as.cookie);
    const res = await req.expect(200);
    return (res.body as { itineraryId: string | null }).itineraryId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    reviewModel = app.get<Model<HotelReview>>(getModelToken(HotelReview.name));
    itineraryModel = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    postModel = app.get<Model<Post>>(getModelToken(Post.name));
    hotelModel = app.get<Model<Hotel>>(getModelToken(Hotel.name));

    author = await createSignedInUser(app, { label: 'mod-author' });
    reader = await createSignedInUser(app, { label: 'mod-reader' });
    admin = await createSignedInUser(app, {
      label: 'mod-admin',
      role: Role.ADMIN,
    });
    userIds.push(author.userId, reader.userId, admin.userId);
    const hotel = await hotelModel.create({
      name: 'test_c2_moderation hotel',
      address: '1 Test Street',
      cityId: 'cairo',
      countryId: 'EG',
      starClass: 3,
      createdBy: new Types.ObjectId(admin.userId),
    });
    hotelId = hotel._id;
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    const owners = userIds.map((id) => new Types.ObjectId(id));
    await reviewModel.deleteMany({ userId: { $in: owners } }).exec();
    await postModel.deleteMany({ authorId: { $in: owners } }).exec();
    await itineraryModel.deleteMany({ userId: { $in: owners } }).exec();
    await hotelModel.deleteMany({ _id: hotelId }).exec();
    await deleteTestUsers(app, userIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  describe('a review an admin has moderated (GEN-10)', () => {
    it(
      'can still be edited and deleted by its author while it is visible',
      async () => {
        const id = await visibleReview();
        await http()
          .patch(`/api/reviews/${id}`)
          .set('Cookie', author.cookie)
          .send({ rating: 5 })
          .expect(200);
        await http()
          .delete(`/api/reviews/${id}`)
          .set('Cookie', author.cookie)
          .expect(200);
      },
      SLOW_MS,
    );

    it(
      'cannot be edited or deleted by its author once hidden',
      async () => {
        const id = await visibleReview();
        await http()
          .patch(`/api/admin/content/REVIEW/${id}/hide`)
          .set('Cookie', admin.cookie)
          .send({ reason: 'Contains a phone number' })
          .expect(200);

        await http()
          .patch(`/api/reviews/${id}`)
          .set('Cookie', author.cookie)
          .send({ comment: 'Edited back after the admin hid it' })
          .expect(404);
        await http()
          .delete(`/api/reviews/${id}`)
          .set('Cookie', author.cookie)
          .expect(404);

        // Still there, unchanged and still hidden: the moderation record stays.
        const stored = await reviewModel.findById(id).lean().exec();
        expect(stored).toMatchObject({
          moderationState: 'HIDDEN',
          comment: 'Quiet rooms, friendly staff',
        });
      },
      SLOW_MS,
    );

    it(
      'cannot be edited or deleted by its author once an admin deleted it',
      async () => {
        const id = await visibleReview();
        await http()
          .delete(`/api/admin/content/REVIEW/${id}`)
          .set('Cookie', admin.cookie)
          .send({ reason: 'Spam' })
          .expect(200);

        await http()
          .patch(`/api/reviews/${id}`)
          .set('Cookie', author.cookie)
          .send({ rating: 1 })
          .expect(404);
        await http()
          .delete(`/api/reviews/${id}`)
          .set('Cookie', author.cookie)
          .expect(404);
        const stored = await reviewModel.findById(id).lean().exec();
        expect(stored?.moderationState).toBe('DELETED');
      },
      SLOW_MS,
    );
  });

  describe("a post's itinerary (BLG-13)", () => {
    it(
      'is shown while the itinerary is public, and hidden while it is private',
      async () => {
        const itineraryId = await publicItinerary();
        const postId = await postWith(itineraryId);
        expect(await shownItinerary(postId)).toBe(itineraryId);
        expect(await shownItinerary(postId, reader)).toBe(itineraryId);

        await setVisibility(itineraryId, 'private');
        expect(await shownItinerary(postId)).toBeNull();
        expect(await shownItinerary(postId, reader)).toBeNull();
        expect(await shownItinerary(postId, author)).toBeNull();

        // Public again: the post shows it again, nothing was detached.
        await setVisibility(itineraryId, 'public');
        expect(await shownItinerary(postId, reader)).toBe(itineraryId);
      },
      SLOW_MS,
    );

    it(
      'is no longer shown once the itinerary is deleted',
      async () => {
        const itineraryId = await publicItinerary();
        const postId = await postWith(itineraryId);
        await http()
          .delete(`/api/itineraries/${itineraryId}`)
          .set('Cookie', author.cookie)
          .expect((res) => expect([200, 204]).toContain(res.status));

        expect(await shownItinerary(postId, reader)).toBeNull();
      },
      SLOW_MS,
    );
  });
});
