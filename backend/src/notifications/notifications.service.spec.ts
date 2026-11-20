import { Logger, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import { EmailService } from './email.service';
import { NotificationType } from './notification-type.enum';
import { NotificationResourceType } from './notification-type.enum';
import { NotificationsService } from './notifications.service';
import { Notification } from './schemas/notification.schema';

type Filter = Record<string, unknown>;

describe('NotificationsService (GEN-01)', () => {
  const NOW = new Date('2026-11-09T12:00:00.000Z');
  const USER_ID = '6720f1c2a1b2c3d4e5f60001';
  const NOTIFICATION_ID = '6720f1c2a1b2c3d4e5f60002';

  let model: {
    insertMany: jest.Mock;
    countDocuments: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
    find: jest.Mock;
  };
  let service: NotificationsService;
  let loggedError: jest.SpyInstance;

  const exec = (value: unknown) => ({
    exec: jest.fn().mockResolvedValue(value),
  });

  beforeEach(() => {
    model = {
      insertMany: jest.fn().mockResolvedValue([]),
      countDocuments: jest.fn().mockReturnValue(exec(4)),
      updateOne: jest.fn().mockReturnValue(exec({ matchedCount: 1 })),
      updateMany: jest.fn().mockReturnValue(exec({ modifiedCount: 4 })),
      find: jest.fn(),
    };
    const users = {
      findById: jest.fn().mockResolvedValue({ email: 'user@example.com' }),
    };
    const email = { send: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationsService(
      model as unknown as Model<Notification>,
      users as unknown as UsersService,
      email as unknown as EmailService,
    );
    loggedError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('notify', () => {
    it('creates an unread notification for the user', async () => {
      await service.notify({
        userId: USER_ID,
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Booking confirmed',
        message: 'Your reservation is confirmed.',
        resourceType: NotificationResourceType.HOTEL_BOOKING,
        resourceId: NOTIFICATION_ID,
      });

      const [rows] = model.insertMany.mock.calls[0] as [
        Record<string, unknown>[],
      ];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: new Types.ObjectId(USER_ID),
        type: NotificationType.BOOKING_CONFIRMED,
        readAt: null,
        resourceType: NotificationResourceType.HOTEL_BOOKING,
      });
    });

    it('defaults the resource fields to null', async () => {
      await service.notify({
        userId: USER_ID,
        type: NotificationType.ACCOUNT_SUSPENDED,
        title: 'Account suspended',
        message: 'An administrator suspended your account.',
      });

      const [rows] = model.insertMany.mock.calls[0] as [
        Record<string, unknown>[],
      ];
      expect(rows[0].resourceType).toBeNull();
      expect(rows[0].resourceId).toBeNull();
    });

    // A notification must never be the reason a payment or a refund fails.
    it('swallows and logs a database failure instead of throwing', async () => {
      model.insertMany.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.notify({
          userId: USER_ID,
          type: NotificationType.REFUND_ISSUED,
          title: 'Refund issued',
          message: 'A refund is on its way.',
        }),
      ).resolves.toBeUndefined();
      expect(loggedError).toHaveBeenCalled();
    });
  });

  describe('notifyMany', () => {
    it('writes a whole batch in one call and keeps going past a bad row', async () => {
      await service.notifyMany([
        {
          userId: USER_ID,
          type: NotificationType.FLIGHT_CANCELLED,
          title: 'Flight cancelled',
          message: 'MS123 was cancelled.',
        },
        {
          userId: NOTIFICATION_ID,
          type: NotificationType.FLIGHT_CANCELLED,
          title: 'Flight cancelled',
          message: 'MS123 was cancelled.',
        },
      ]);

      const [rows, options] = model.insertMany.mock.calls[0] as [
        unknown[],
        Record<string, unknown>,
      ];
      expect(rows).toHaveLength(2);
      expect(options).toEqual({ ordered: false });
    });

    it('does nothing for an empty batch', async () => {
      await service.notifyMany([]);
      expect(model.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('unreadCount', () => {
    it('counts only this account’s unread rows', async () => {
      await expect(service.unreadCount(USER_ID)).resolves.toBe(4);

      const [filter] = model.countDocuments.mock.calls[0] as [Filter];
      expect(filter).toEqual({
        userId: new Types.ObjectId(USER_ID),
        readAt: null,
      });
    });
  });

  describe('markAsRead (ACC-11)', () => {
    it('includes the account id in the filter, so one cannot mark another’s', async () => {
      await service.markAsRead(USER_ID, NOTIFICATION_ID, NOW);

      const [filter] = model.updateOne.mock.calls[0] as [Filter];
      expect(filter).toEqual({
        _id: new Types.ObjectId(NOTIFICATION_ID),
        userId: new Types.ObjectId(USER_ID),
      });
    });

    it('keeps the first read time when it is already read', async () => {
      await service.markAsRead(USER_ID, NOTIFICATION_ID, NOW);

      const [, update, options] = model.updateOne.mock.calls[0] as [
        Filter,
        unknown[],
        Filter,
      ];
      expect(update).toEqual([
        { $set: { readAt: { $ifNull: ['$readAt', NOW] } } },
      ]);
      // Mongoose 9 refuses a pipeline update without this option.
      expect(options).toMatchObject({ updatePipeline: true });
    });

    it('answers 404 for a notification of another account', async () => {
      model.updateOne.mockReturnValue(exec({ matchedCount: 0 }));

      await expect(
        service.markAsRead(USER_ID, NOTIFICATION_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 for a malformed id without querying', async () => {
      await expect(service.markAsRead(USER_ID, 'nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('markAllAsRead', () => {
    it('touches only this account’s unread rows', async () => {
      await expect(service.markAllAsRead(USER_ID, NOW)).resolves.toBe(4);

      const [filter] = model.updateMany.mock.calls[0] as [Filter];
      expect(filter).toEqual({
        userId: new Types.ObjectId(USER_ID),
        readAt: null,
      });
    });
  });
});
