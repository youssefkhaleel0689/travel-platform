// D2 reports, admin moderation and the audit log end to end (GEN-07, GEN-09,
// GEN-10). The suite removes its posts, comments, itineraries, reports and
// the audit rows its own admin wrote. Audit rows are append-only through the
// model, so they are removed with the driver directly, and only for this
// run's admin.
import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Comment } from './../src/blog/schemas/comment.schema';
import { Post } from './../src/blog/schemas/post.schema';
import { Itinerary } from './../src/itineraries/schemas/itinerary.schema';
import { Role } from './../src/common/auth/auth.enums';
import { Report } from './../src/moderation/schemas/report.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

describe('Reports, moderation and audit log (e2e)', () => {
  let app: INestApplication<App>;
  const userIds: string[] = [];
  let author: SignedInUser;
  let reader: SignedInUser;
  let admin: SignedInUser;

  const http = () => request(app.getHttpServer());

  async function publish(): Promise<string> {
    const res = await http()
      .post('/api/posts')
      .set('Cookie', author.cookie)
      .send({ title: 'Reported post', body: 'Body', status: 'PUBLISHED' })
      .expect(201);
    return res.body.id as string;
  }

  function report(postId: string, as = reader) {
    return http()
      .post('/api/reports')
      .set('Cookie', as.cookie)
      .send({ targetType: 'post', targetId: postId, reason: 'SPAM' });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    author = await createSignedInUser(app, { label: 'mod-author' });
    reader = await createSignedInUser(app, { label: 'mod-reader' });
    admin = await createSignedInUser(app, {
      role: Role.ADMIN,
      label: 'mod-admin',
    });
    userIds.push(author.userId, reader.userId, admin.userId);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    const ids = userIds.map((id) => new Types.ObjectId(id));
    const postModel = app.get<Model<Post>>(getModelToken(Post.name));
    const posts = await postModel
      .find({ authorId: { $in: ids } })
      .select('_id')
      .lean()
      .exec();
    const postIds = posts.map((p) => p._id);
    await app
      .get<Model<Report>>(getModelToken(Report.name))
      .deleteMany({ reporterId: { $in: ids } })
      .exec();
    await app
      .get<Model<Comment>>(getModelToken(Comment.name))
      .deleteMany({ postId: { $in: postIds } })
      .exec();
    await postModel.deleteMany({ _id: { $in: postIds } }).exec();
    await app
      .get<Model<Itinerary>>(getModelToken(Itinerary.name))
      .deleteMany({ userId: { $in: ids } })
      .exec();
    await app
      .get<Connection>(getConnectionToken())
      .collection('auditLogs')
      .deleteMany({ actorId: new Types.ObjectId(admin.userId) });
    await deleteTestUsers(app, userIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  describe('POST /api/reports (GEN-09)', () => {
    it('accepts one report per user per item', async () => {
      const postId = await publish();
      const first = await report(postId).expect(201);
      expect(first.body).toMatchObject({ status: 'OPEN', reason: 'SPAM' });
      const second = await report(postId).expect(409);
      expect(second.body.code).toBe('ALREADY_REPORTED');
    });

    it('refuses your own content, invisible content and OTHER without details', async () => {
      const postId = await publish();
      expect((await report(postId, author).expect(400)).body.code).toBe(
        'CANNOT_REPORT_OWN_CONTENT',
      );

      const draft = await http()
        .post('/api/posts')
        .set('Cookie', author.cookie)
        .send({ title: 'Draft', body: 'b', status: 'DRAFT' })
        .expect(201);
      await report(draft.body.id).expect(404);

      await http()
        .post('/api/reports')
        .set('Cookie', reader.cookie)
        .send({ targetType: 'POST', targetId: postId, reason: 'OTHER' })
        .expect(400);
      await http()
        .post('/api/reports')
        .send({ targetType: 'POST', targetId: postId, reason: 'SPAM' })
        .expect(401);
    });
  });

  describe('admin moderation (GEN-10) and the audit log (GEN-07)', () => {
    it('is admin only', async () => {
      await http()
        .get('/api/admin/reports')
        .set('Cookie', reader.cookie)
        .expect(403);
      await http()
        .get('/api/admin/audit-logs')
        .set('Cookie', reader.cookie)
        .expect(403);
    });

    it(
      'hides reported content for everyone but its author and admins, and logs it',
      async () => {
        const postId = await publish();
        const reported = await report(postId).expect(201);

        const queue = await http()
          .get('/api/admin/reports')
          .set('Cookie', admin.cookie)
          .expect(200);
        expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(
          reported.body.id,
        );

        const resolved = await http()
          .patch(`/api/admin/reports/${reported.body.id}`)
          .set('Cookie', admin.cookie)
          .send({ decision: 'HIDE' })
          .expect(200);
        expect(resolved.body.status).toBe('HIDDEN');
        await http()
          .patch(`/api/admin/reports/${reported.body.id}`)
          .set('Cookie', admin.cookie)
          .send({ decision: 'DISMISS' })
          .expect(409);

        await http().get(`/api/posts/${postId}`).expect(404);
        await http()
          .get(`/api/posts/${postId}`)
          .set('Cookie', reader.cookie)
          .expect(404);
        const own = await http()
          .get(`/api/posts/${postId}`)
          .set('Cookie', author.cookie)
          .expect(200);
        expect(own.body.moderationState).toBe('HIDDEN');

        const log = await http()
          .get(`/api/admin/audit-logs?entityId=${postId}`)
          .set('Cookie', admin.cookie)
          .expect(200);
        expect(log.body.items[0]).toMatchObject({
          action: 'CONTENT_HIDDEN',
          entityType: 'POST',
          actorId: admin.userId,
          before: { moderationState: 'VISIBLE' },
        });

        const restored = await http()
          .patch(`/api/admin/content/post/${postId}/restore`)
          .set('Cookie', admin.cookie)
          .expect(200);
        expect(restored.body).toMatchObject({
          before: 'HIDDEN',
          after: 'VISIBLE',
          changed: true,
        });
        await http().get(`/api/posts/${postId}`).expect(200);
      },
      SLOW_MS,
    );

    it(
      'deletes content for good and refuses to restore it',
      async () => {
        const postId = await publish();
        await http()
          .delete(`/api/admin/content/POST/${postId}`)
          .set('Cookie', admin.cookie)
          .expect(200);
        await http()
          .get(`/api/posts/${postId}`)
          .set('Cookie', author.cookie)
          .expect(404);
        await http()
          .get(`/api/posts/${postId}`)
          .set('Cookie', admin.cookie)
          .expect(200);
        const restore = await http()
          .patch(`/api/admin/content/post/${postId}/restore`)
          .set('Cookie', admin.cookie)
          .expect(409);
        expect(restore.body.code).toBe('INVALID_MODERATION_CHANGE');
      },
      SLOW_MS,
    );

    it(
      'takes a hidden comment off the post count and puts it back on restore',
      async () => {
        const postId = await publish();
        const comment = await http()
          .post(`/api/posts/${postId}/comments`)
          .set('Cookie', reader.cookie)
          .send({ body: 'Rude comment' })
          .expect(201);

        await http()
          .patch(`/api/admin/content/comment/${comment.body.id}/hide`)
          .set('Cookie', admin.cookie)
          .expect(200);
        expect(
          (await http().get(`/api/posts/${postId}`).expect(200)).body
            .commentCount,
        ).toBe(0);
        const asAuthor = await http()
          .get(`/api/posts/${postId}/comments`)
          .set('Cookie', reader.cookie)
          .expect(200);
        expect(asAuthor.body.items[0].moderationState).toBe('HIDDEN');

        await http()
          .patch(`/api/admin/content/comment/${comment.body.id}/restore`)
          .set('Cookie', admin.cookie)
          .expect(200);
        expect(
          (await http().get(`/api/posts/${postId}`).expect(200)).body
            .commentCount,
        ).toBe(1);
      },
      SLOW_MS,
    );

    it(
      'hides a public itinerary from search, the public view and cloning',
      async () => {
        const created = await http()
          .post('/api/itineraries')
          .set('Cookie', author.cookie)
          .send({
            title: 'Reported trip',
            countries: ['FR'],
            startDate: '2026-12-20',
          })
          .expect(201);
        const id = created.body.id as string;
        await http()
          .patch(`/api/itineraries/${id}/visibility`)
          .set('Cookie', author.cookie)
          .send({ visibility: 'public' })
          .expect(200);

        await http()
          .post('/api/reports')
          .set('Cookie', reader.cookie)
          .send({ targetType: 'itinerary', targetId: id, reason: 'SPAM' })
          .expect(201);
        await http()
          .patch(`/api/admin/content/itinerary/${id}/hide`)
          .set('Cookie', admin.cookie)
          .expect(200);

        await http().get(`/api/itineraries/public/${id}`).expect(404);
        await http()
          .post(`/api/itineraries/${id}/clone`)
          .set('Cookie', reader.cookie)
          .expect(404);
        const search = await http()
          .get('/api/itineraries/public/search?q=Reported%20trip')
          .expect(200);
        expect(
          search.body.items.map((i: { id: string }) => i.id),
        ).not.toContain(id);
        await http()
          .get(`/api/itineraries/${id}`)
          .set('Cookie', author.cookie)
          .expect(200);

        await http()
          .delete(`/api/admin/content/itinerary/${id}`)
          .set('Cookie', admin.cookie)
          .expect(200);
        await http()
          .get(`/api/itineraries/${id}`)
          .set('Cookie', author.cookie)
          .expect(404);
      },
      SLOW_MS,
    );

    it('answers 404 for unknown content and 400 for an unknown type', async () => {
      await http()
        .patch('/api/admin/content/post/6720f1c2a1b2c3d4e5f60799/hide')
        .set('Cookie', admin.cookie)
        .expect(404);
      await http()
        .patch('/api/admin/content/photo/6720f1c2a1b2c3d4e5f60799/hide')
        .set('Cookie', admin.cookie)
        .expect(400);
    });
  });
});
