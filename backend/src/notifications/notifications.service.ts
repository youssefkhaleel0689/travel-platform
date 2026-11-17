import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { LeanDoc, paginateQuery } from '../common/pagination/paginate';
import { PageDto } from '../common/pagination/dto/page.dto';
import {
  NotificationResourceType,
  NotificationType,
} from './notification-type.enum';
import { Notification } from './schemas/notification.schema';

export interface NotifyInput {
  userId: Types.ObjectId | string;
  type: NotificationType;
  title: string;
  message: string;
  resourceType?: NotificationResourceType;
  resourceId?: string;
}

/**
 * The in-app notification service every module uses (GEN-01).
 *
 * Creating a notification must never be the reason a booking, a refund or an
 * admin action fails, so notify() and notifyMany() log a failure and carry on
 * instead of throwing. A user who misses a notice is a smaller problem than a
 * confirmed payment that reports an error.
 *
 * Import NotificationsModule and inject this service; do not inject the
 * Notification model in another module.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
  ) {}

  /** Creates one notification. Never throws. */
  async notify(input: NotifyInput): Promise<void> {
    await this.notifyMany([input]);
  }

  /**
   * Creates several notifications in one round trip, for example one per
   * passenger when a flight is cancelled (FLT-06). Never throws.
   */
  async notifyMany(inputs: NotifyInput[]): Promise<void> {
    if (inputs.length === 0) {
      return;
    }
    try {
      await this.notificationModel.insertMany(
        inputs.map((input) => ({
          userId: new Types.ObjectId(input.userId),
          type: input.type,
          title: input.title,
          message: input.message,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          readAt: null,
        })),
        // One bad row must not discard the rest of a batch.
        { ordered: false },
      );
    } catch (error) {
      this.logger.error(
        `Could not create ${inputs.length} notification(s)`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** GEN-01, GEN-05: one account's notifications, newest first, 10 per page. */
  async list(
    userId: string,
    page: number,
    options: { unreadOnly?: boolean } = {},
  ): Promise<PageDto<LeanDoc<Notification>>> {
    const filter: QueryFilter<Notification> = {
      userId: new Types.ObjectId(userId),
    };
    if (options.unreadOnly) {
      filter.readAt = null;
    }
    return paginateQuery(this.notificationModel, filter, {
      page,
      // _id descending as well: an ObjectId grows over time, so notifications
      // written in the same millisecond (a batch for one flight cancellation)
      // still come out newest first instead of oldest first on the tie.
      sort: { createdAt: -1, _id: -1 },
    });
  }

  /** GEN-01: the unread badge. */
  async unreadCount(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({ userId: new Types.ObjectId(userId), readAt: null })
      .exec();
  }

  /**
   * GEN-01: marks one notification as read.
   *
   * The account id is part of the filter, not checked afterwards, so one
   * account cannot mark another's notification - and cannot learn that the id
   * exists either, because both cases give the same 404 (ACC-11).
   *
   * Marking an already-read notification changes nothing and still succeeds.
   */
  async markAsRead(
    userId: string,
    notificationId: string,
    now = new Date(),
  ): Promise<void> {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new NotFoundException('Notification not found');
    }
    const result = await this.notificationModel
      .updateOne(
        {
          _id: new Types.ObjectId(notificationId),
          userId: new Types.ObjectId(userId),
        },
        // $ifNull keeps the first read time, so marking an already-read
        // notification succeeds without moving the timestamp. An aggregation
        // pipeline as the update needs updatePipeline in Mongoose 9.
        [{ $set: { readAt: { $ifNull: ['$readAt', now] } } }],
        { timestamps: false, updatePipeline: true },
      )
      .exec();

    if (result.matchedCount === 0) {
      throw new NotFoundException('Notification not found');
    }
  }

  /** GEN-01: marks every unread notification of the account as read. */
  async markAllAsRead(userId: string, now = new Date()): Promise<number> {
    const result = await this.notificationModel
      .updateMany(
        { userId: new Types.ObjectId(userId), readAt: null },
        { $set: { readAt: now } },
        { timestamps: false },
      )
      .exec();
    return result.modifiedCount;
  }
}
