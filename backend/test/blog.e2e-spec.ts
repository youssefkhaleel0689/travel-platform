// D2 blog end to end against the shared database (BLG-01 to BLG-10, BLG-12,
// GEN-08). Accounts come from the shared helper (test_c2_ emails); every
// post, comment, like and image this suite creates is removed in afterAll.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Comment } from './../src/blog/schemas/comment.schema';
import { Like } from './../src/blog/schemas/like.schema';
import { Post } from './../src/blog/schemas/post.schema';
import { MediaTargetType } from './../src/media/media.constants';
import { MediaService } from './../src/media/media.service';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

// The smallest valid PNG signature plus a few bytes: enough for the type check.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const GIF = Buffer.from('GIF89a' + 'x'.repeat(64));

describe('Blog (e2e)', () => {
  let app: INestApplication<App>;
  let postModel: Model<Post>;
  const userIds: string[] = [];
  let author: SignedInUser;
  let reader: SignedInUser;
  // A unique word so searches only find this run's posts.
  const marker = `zq${Date.now().toString(36)}`;

  const http = () => request(app.getHttpServer());

  async function createPost(
    as: SignedInUser,
    body: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await http()
      .post('/api/posts')
      .set('Cookie', as.cookie)
      .send({
        title: `Luxor ${marker}`,
        body: 'We started at Karnak at sunrise.',
        status: 'PUBLISHED',
        ...body,
      })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    postModel = app.get<Model<Post>>(getModelToken(Post.name));

    author = await createSignedInUser(app, { label: 'blog-author' });
    reader = await createSignedInUser(app, { label: 'blog-reader' });
    userIds.push(author.userId, reader.userId);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    const authors = userIds.map((id) => new Types.ObjectId(id));
    const posts = await postModel.find({ authorId: { $in: authors } }).select('_id').lean().exec();
    const postIds = posts.map((p) => p._id);
    const media = app.get(MediaService);
    await Promise.all(
      postIds.map((id) => media.removeAllForTarget(MediaTargetType.POST, id.toString())),
    );
    await app.get<Model<Comment>>(getModelToken(Comment.name)).deleteMany({ postId: { $in: postIds } }).exec();
    await app.get<Model<Like>>(getModelToken(Like.name)).deleteMany({ postId: { $in: postIds } }).exec();
    await postModel.deleteMany({ _id: { $in: postIds } }).exec();
    await deleteTestUsers(app, userIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  describe('posts (BLG-01 to BLG-04)', () => {
    it('keeps a draft private until it is published', async () => {
      const id = await createPost(author, { status: 'DRAFT' });

      await http().get(`/api/posts/${id}`).expect(404);
      await http().get(`/api/posts/${id}`).set('Cookie', reader.cookie).expect(404);
      const own = await http().get(`/api/posts/${id}`).set('Cookie', author.cookie).expect(200);
      expect(own.body).toMatchObject({ status: 'DRAFT', isAuthor: true, publishedAt: null });

      const mine = await http().get('/api/posts/mine').set('Cookie', author.cookie).expect(200);
      expect(mine.body.items.map((p: { id: string }) => p.id)).toContain(id);

      const published = await http()
        .patch(`/api/posts/${id}`)
        .set('Cookie', author.cookie)
        .send({ status: 'PUBLISHED' })
        .expect(200);
      expect(published.body.publishedAt).not.toBeNull();
      await http().get(`/api/posts/${id}`).expect(200);
    }, SLOW_MS);

    it('validates title, body and tags with field errors (BLG-01, BLG-08)', async () => {
      const res = await http()
        .post('/api/posts')
        .set('Cookie', author.cookie)
        .send({
          title: '   ',
          body: 'x',
          status: 'PUBLISHED',
          tags: ['a', 'b', 'c', 'd', 'e', 'f'],
        })
        .expect(400);
      const fields = res.body.errors.map((e: { field: string }) => e.field);
      expect(fields).toEqual(expect.arrayContaining(['title', 'tags']));
    });

    it('normalises tags: "Egypt" and " egypt " are one tag', async () => {
      const id = await createPost(author, { tags: ['Egypt', ' egypt ', 'Nile  Cruise'] });
      const res = await http().get(`/api/posts/${id}`).expect(200);
      expect(res.body.tags).toEqual(['egypt', 'nile cruise']);
    });

    it('lets only the author edit or delete (ACC-11: 404 for anyone else)', async () => {
      const id = await createPost(author);
      await http().patch(`/api/posts/${id}`).set('Cookie', reader.cookie).send({ title: 'Mine now' }).expect(404);
      await http().delete(`/api/posts/${id}`).set('Cookie', reader.cookie).expect(404);
      await http().patch(`/api/posts/${id}`).set('Cookie', author.cookie).send({}).expect(400);
      await http().delete(`/api/posts/${id}`).set('Cookie', author.cookie).expect(204);
      await http().get(`/api/posts/${id}`).set('Cookie', author.cookie).expect(404);
    });

    it('requires a login to write', async () => {
      await http().post('/api/posts').send({ title: 't', body: 'b', status: 'DRAFT' }).expect(401);
    });
  });

  describe('search and tags (BLG-02, BLG-08, BLG-09)', () => {
    it('finds posts by title, tag and author name, ranked by interactions', async () => {
      const quiet = await createPost(author, { title: `Quiet ${marker}` });
      const popular = await createPost(author, { title: `Popular ${marker}` });
      await http().post(`/api/posts/${popular}/like`).set('Cookie', reader.cookie).expect(200);

      const byTitle = await http().get(`/api/posts?keyword=${marker}`).expect(200);
      const ids = byTitle.body.items.map((p: { id: string }) => p.id);
      expect(ids.indexOf(popular)).toBeLessThan(ids.indexOf(quiet));
      expect(byTitle.body.items[0]).toHaveProperty('excerpt');

      const tagged = await createPost(author, { title: 'Tagged', tags: [`${marker}tag`] });
      const byTag = await http().get(`/api/posts?keyword=${marker}TAG`).expect(200);
      expect(byTag.body.items.map((p: { id: string }) => p.id)).toContain(tagged);

      const tagPage = await http().get(`/api/tags/${marker.toUpperCase()}TAG/posts`).expect(200);
      expect(tagPage.body.items.map((p: { id: string }) => p.id)).toEqual([tagged]);
    }, SLOW_MS);

    it('treats regular-expression characters in a keyword as text', async () => {
      const res = await http().get(`/api/posts?keyword=${encodeURIComponent('(.*)+$')}`).expect(200);
      expect(res.body.meta.page).toBe(1);
    });

    it('returns an empty page for no results', async () => {
      const res = await http().get(`/api/posts?keyword=${marker}nothing`).expect(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });
  });

  describe('likes and comments (BLG-05 to BLG-07)', () => {
    it('counts one like per user, even when liked twice', async () => {
      const id = await createPost(author);
      await http().post(`/api/posts/${id}/like`).set('Cookie', reader.cookie).expect(200);
      const again = await http().post(`/api/posts/${id}/like`).set('Cookie', reader.cookie).expect(200);
      expect(again.body).toEqual({ postId: id, liked: true, likeCount: 1 });

      const page = await http().get(`/api/posts/${id}`).set('Cookie', reader.cookie).expect(200);
      expect(page.body.likedByMe).toBe(true);

      const unliked = await http().delete(`/api/posts/${id}/like`).set('Cookie', reader.cookie).expect(200);
      expect(unliked.body.likeCount).toBe(0);
    });

    it('adds, edits and deletes comments in chronological order', async () => {
      const id = await createPost(author);
      const first = await http().post(`/api/posts/${id}/comments`).set('Cookie', reader.cookie).send({ body: 'First!' }).expect(201);
      await http().post(`/api/posts/${id}/comments`).set('Cookie', author.cookie).send({ body: 'Thanks' }).expect(201);
      await http().post(`/api/posts/${id}/comments`).set('Cookie', reader.cookie).send({ body: 'x'.repeat(501) }).expect(400);
      await http().post(`/api/posts/${id}/comments`).set('Cookie', reader.cookie).send({ body: '   ' }).expect(400);

      const page = await http().get(`/api/posts/${id}`).expect(200);
      expect(page.body.commentCount).toBe(2);
      expect(page.body.comments.items.map((c: { body: string }) => c.body)).toEqual(['First!', 'Thanks']);

      const commentId = first.body.id as string;
      await http().patch(`/api/comments/${commentId}`).set('Cookie', author.cookie).send({ body: 'Hijack' }).expect(404);
      const edited = await http().patch(`/api/comments/${commentId}`).set('Cookie', reader.cookie).send({ body: 'First, edited' }).expect(200);
      expect(edited.body.edited).toBe(true);

      await http().delete(`/api/comments/${commentId}`).set('Cookie', reader.cookie).expect(204);
      const after = await http().get(`/api/posts/${id}`).expect(200);
      expect(after.body.commentCount).toBe(1);
    }, SLOW_MS);

    it('refuses to like or comment on a draft', async () => {
      const draft = await createPost(author, { status: 'DRAFT' });
      await http().post(`/api/posts/${draft}/like`).set('Cookie', reader.cookie).expect(404);
      await http().post(`/api/posts/${draft}/comments`).set('Cookie', reader.cookie).send({ body: 'hi' }).expect(404);
    });
  });

  describe('images (BLG-10, GEN-08)', () => {
    it('stores a PNG, serves it by URL and removes it', async () => {
      const id = await createPost(author);
      const uploaded = await http()
        .post(`/api/posts/${id}/images`)
        .set('Cookie', author.cookie)
        .attach('file', PNG, { filename: 'photo.png', contentType: 'image/png' })
        .expect(201);
      expect(uploaded.body.url).toBe(`/api/posts/${id}/images/${uploaded.body.id}`);

      const served = await http().get(uploaded.body.url).expect(200);
      expect(served.headers['content-type']).toContain('image/png');

      await http().delete(uploaded.body.url).set('Cookie', reader.cookie).expect(404);
      await http().delete(uploaded.body.url).set('Cookie', author.cookie).expect(204);
      await http().get(uploaded.body.url).expect(404);
    }, SLOW_MS);

    it('refuses a non-image whatever its name, and a sixth image', async () => {
      const id = await createPost(author);
      const bad = await http()
        .post(`/api/posts/${id}/images`)
        .set('Cookie', author.cookie)
        .attach('file', GIF, { filename: 'fake.png', contentType: 'image/png' })
        .expect(400);
      expect(bad.body.code).toBe('INVALID_FILE_TYPE');

      for (let i = 0; i < 5; i += 1) {
        await http().post(`/api/posts/${id}/images`).set('Cookie', author.cookie)
          .attach('file', PNG, { filename: `p${i}.png`, contentType: 'image/png' }).expect(201);
      }
      const sixth = await http().post(`/api/posts/${id}/images`).set('Cookie', author.cookie)
        .attach('file', PNG, { filename: 'p6.png', contentType: 'image/png' }).expect(409);
      expect(sixth.body.code).toBe('IMAGE_LIMIT_REACHED');
    }, 60_000);

    it('refuses a file over 5 MB', async () => {
      const id = await createPost(author);
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
      const res = await http().post(`/api/posts/${id}/images`).set('Cookie', author.cookie)
        .attach('file', big, { filename: 'big.png', contentType: 'image/png' }).expect(400);
      expect(res.body.code).toBe('FILE_TOO_LARGE');
    }, SLOW_MS);
  });

  describe('author page (BLG-12)', () => {
    it('shows name, join date and published posts only', async () => {
      const published = await createPost(author);
      const draft = await createPost(author, { status: 'DRAFT' });
      const res = await http().get(`/api/authors/${author.userId}`).expect(200);
      expect(res.body).toMatchObject({ id: author.userId, name: expect.any(String) });
      expect(res.body.joinedAt).toEqual(expect.any(String));
      const ids = res.body.posts.items.map((p: { id: string }) => p.id);
      expect(ids).toContain(published);
      expect(ids).not.toContain(draft);
      expect(Array.isArray(res.body.publicItineraries.items)).toBe(true);
    });

    it('answers 404 for an unknown author', async () => {
      await http().get('/api/authors/6720f1c2a1b2c3d4e5f60799').expect(404);
    });
  });
});
