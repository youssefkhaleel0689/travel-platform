// GEN-01 end to end against the shared database. Notifications are created
// through NotificationsService, the same way every other module creates them,
// and are deleted again in afterAll.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import {
  NotificationResourceType,
  NotificationType,
} from './../src/notifications/notification-type.enum';
import { NotificationsService } from './../src/notifications/notifications.service';
import { Notification } from './../src/notifications/schemas/notification.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 90_000;
const SLOW_MS = 30_000;
const LIST = '/api/notifications';

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let notifications: NotificationsService;
  let notificationModel: Model<Notification>;
  const createdUserIds: string[] = [];
  let user: SignedInUser;
  let other: SignedInUser;

  async function seedNotifications(
    forUserId: string,
    count: number,
  ): Promise<void> {
    await notifications.notifyMany(
      Array.from({ length: count }, (_, index) => ({
        userId: forUserId,
        type: NotificationType.BOOKING_CONFIRMED,
        title: `Booking confirmed ${index + 1}`,
        message: `Reservation number ${index + 1} is confirmed.`,
        resourceType: NotificationResourceType.HOTEL_BOOKING,
        resourceId: new Types.ObjectId().toString(),
      })),
    );
  }

  async function clearNotifications(): Promise<void> {
    await notificationModel
      .deleteMany({
        userId: { $in: createdUserIds.map((id) => new Types.ObjectId(id)) },
      })
      .exec();
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    notifications = app.get(NotificationsService);
    notificationModel = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );

    user = await createSignedInUser(app, { label: 'notif' });
    other = await createSignedInUser(app, { label: 'notif-other' });
    createdUserIds.push(user.userId, other.userId);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    await clearNotifications();
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  beforeEach(async () => {
    await clearNotifications();
  });

  describe('GET /api/notifications', () => {
    it('returns the account’s notifications newest first, 10 to a page', async () => {
      await seedNotifications(user.userId, 12);

      const res = await request(app.getHttpServer())
        .get(LIST)
        .set('Cookie', user.cookie)
        .expect(200);

      expect(res.body.items).toHaveLength(10);
      expect(res.body.meta).toEqual({
        page: 1,
        pageSize: 10,
        totalItems: 12,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      });
      // Newest first.
      expect(res.body.items[0].title).toBe('Booking confirmed 12');

      const page2 = await request(app.getHttpServer())
        .get(`${LIST}?page=2`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.meta.hasNextPage).toBe(false);
    }, SLOW_MS);

    it('returns the documented item shape without _id or __v', async () => {
      await seedNotifications(user.userId, 1);

      const res = await request(app.getHttpServer())
        .get(LIST)
        .set('Cookie', user.cookie)
        .expect(200);

      expect(res.body.items[0]).toEqual({
        id: expect.stringMatching(/^[a-f\d]{24}$/),
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Booking confirmed 1',
        message: 'Reservation number 1 is confirmed.',
        resourceType: NotificationResourceType.HOTEL_BOOKING,
        resourceId: expect.stringMatching(/^[a-f\d]{24}$/),
        read: false,
        readAt: null,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    // ACC-11: the account id comes from the cookie, so there is no way to ask
    // for someone else's list.
    it('never shows another account’s notifications', async () => {
      await seedNotifications(other.userId, 3);

      const res = await request(app.getHttpServer())
        .get(LIST)
        .set('Cookie', user.cookie)
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.meta.totalItems).toBe(0);
    });

    it('filters to unread with unreadOnly=true', async () => {
      await seedNotifications(user.userId, 3);
      const all = await request(app.getHttpServer())
        .get(LIST)
        .set('Cookie', user.cookie)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`${LIST}/${all.body.items[0].id}/read`)
        .set('Cookie', user.cookie)
        .expect(204);

      const unread = await request(app.getHttpServer())
        .get(`${LIST}?unreadOnly=true`)
        .set('Cookie', user.cookie)
        .expect(200);

      expect(unread.body.meta.totalItems).toBe(2);
      expect(
        unread.body.items.every((item: { read: boolean }) => !item.read),
      ).toBe(true);
    });

    it.each(['yes', '1', ''])(
      'rejects unreadOnly=%s with a field error',
      async (value) => {
        const res = await request(app.getHttpServer())
          .get(`${LIST}?unreadOnly=${value}`)
          .set('Cookie', user.cookie)
          .expect(400);

        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(res.body.errors[0].field).toBe('unreadOnly');
      },
    );

    // GEN-05: the page size is fixed, so limit is not a parameter.
    it('rejects a limit parameter', async () => {
      const res = await request(app.getHttpServer())
        .get(`${LIST}?limit=50`)
        .set('Cookie', user.cookie)
        .expect(400);

      expect(res.body.errors[0].field).toBe('limit');
    });

    it('returns an empty page beyond the last one', async () => {
      await seedNotifications(user.userId, 2);

      const res = await request(app.getHttpServer())
        .get(`${LIST}?page=9`)
        .set('Cookie', user.cookie)
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.meta.totalItems).toBe(2);
    });

    it('rejects an anonymous request (401)', async () => {
      await request(app.getHttpServer()).get(LIST).expect(401);
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('counts the unread ones only', async () => {
      await seedNotifications(user.userId, 4);

      const before = await request(app.getHttpServer())
        .get(`${LIST}/unread-count`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(before.body).toEqual({ unreadCount: 4 });

      const list = await request(app.getHttpServer())
        .get(LIST)
        .set('Cookie', user.cookie)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`${LIST}/${list.body.items[0].id}/read`)
        .set('Cookie', user.cookie)
        .expect(204);

      const after = await request(app.getHttpServer())
        .get(`${LIST}/unread-count`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(after.body).toEqual({ unreadCount: 3 });
    });

    it('is 0 with no notifications', async () => {
      const res = await request(app.getHttpServer())
        .get(`${LIST}/unread-count`)
        .set('Cookie', user.cookie)
        .expect(200);

      expect(res.body).toEqual({ unreadCount: 0 });
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('marks one as read and keeps the first read time', async () => {
      await seedNotifications(user.userId, 1);
      const list = await request(app.getHttpServer())
        .get(LIST)
        .set('Cookie', user.cookie)
        .expect(200);
      const id = list.body.items[0].id;

      await request(app.getHttpServer())
        .patch(`${LIST}/${id}/read`)
        .set('Cookie', user.cookie)
        .expect(204);

      const afterFirst = await request(app.getHttpServer())
        .get(LIST)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(afterFirst.body.items[0].read).toBe(true);
      const firstReadAt = afterFirst.body.items[0].readAt;
      expect(firstReadAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Marking it again is allowed and does not move the timestamp.
      await request(app.getHttpServer())
        .patch(`${LIST}/${id}/read`)
        .set('Cookie', user.cookie)
        .expect(204);
      const afterSecond = await request(app.getHttpServer())
        .get(LIST)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(afterSecond.body.items[0].readAt).toBe(firstReadAt);
    });

    // ACC-11: another account's notification is indistinguishable from one
    // that does not exist, so no id can be probed.
    it('answers 404 for another account’s notification', async () => {
      await seedNotifications(other.userId, 1);
      const list = await request(app.getHttpServer())
        .get(LIST)
        .set('Cookie', other.cookie)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${LIST}/${list.body.items[0].id}/read`)
        .set('Cookie', user.cookie)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');

      // It is still unread for its owner.
      const owner = await request(app.getHttpServer())
        .get(`${LIST}/unread-count`)
        .set('Cookie', other.cookie)
        .expect(200);
      expect(owner.body.unreadCount).toBe(1);
    });

    it('answers 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .patch(`${LIST}/${new Types.ObjectId().toString()}/read`)
        .set('Cookie', user.cookie)
        .expect(404);
    });

    it('answers 404 for a malformed id', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${LIST}/not-an-id/read`)
        .set('Cookie', user.cookie)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /api/notifications/read-all', () => {
    it('marks every unread notification as read', async () => {
      await seedNotifications(user.userId, 5);

      await request(app.getHttpServer())
        .patch(`${LIST}/read-all`)
        .set('Cookie', user.cookie)
        .expect(204);

      const res = await request(app.getHttpServer())
        .get(`${LIST}/unread-count`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toEqual({ unreadCount: 0 });
    });

    it('succeeds when nothing was unread', async () => {
      await request(app.getHttpServer())
        .patch(`${LIST}/read-all`)
        .set('Cookie', user.cookie)
        .expect(204);
    });

    it('leaves other accounts untouched', async () => {
      await seedNotifications(other.userId, 2);

      await request(app.getHttpServer())
        .patch(`${LIST}/read-all`)
        .set('Cookie', user.cookie)
        .expect(204);

      const res = await request(app.getHttpServer())
        .get(`${LIST}/unread-count`)
        .set('Cookie', other.cookie)
        .expect(200);
      expect(res.body).toEqual({ unreadCount: 2 });
    });
  });
});
