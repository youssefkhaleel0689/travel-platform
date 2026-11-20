import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { fieldBadRequest } from '../common/validation/field-error';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  HotelReview,
  HotelReviewDocument,
  ReviewModerationState,
} from './schemas/hotel-review.schema';
import {
  HotelBooking,
  HotelBookingDocument,
  HotelBookingStatus,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import {
  CreateHotelReviewDto,
  ReplyReviewDto,
  UpdateHotelReviewDto,
} from './dto/review.dto';
import { HotelsService } from '../hotels/hotels.service';
import { UsersService } from '../auth/users/users.service';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { oid, rethrowDuplicate } from '../common/mongo';
import { PageDto, PageMetaDto } from '../common/pagination/dto/page.dto';
import { PAGE_SIZE } from '../common/pagination/pagination.constants';
import { todayUtc } from '../common/dates';
import {
  applyModeration,
  ModeratedContent,
  ModerationResult,
} from '../common/moderation/content-moderation.port';
import { ModerationState } from '../common/moderation/moderation-state';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(HotelReview.name)
    private readonly reviewModel: Model<HotelReviewDocument>,
    @InjectModel(HotelBooking.name)
    private readonly bookingModel: Model<HotelBookingDocument>,
    private readonly hotels: HotelsService,
    private readonly users: UsersService,
  ) {}

  /** HTL-23: one rating/review per COMPLETED reservation of the current user. */
  async create(
    user: AuthenticatedUser,
    bookingId: string,
    dto: CreateHotelReviewDto,
  ) {
    const booking = await this.bookingModel
      .findOne({ _id: oid(bookingId, 'bookingId'), userId: oid(user.userId) })
      .exec();
    if (!booking) throw new NotFoundException('Hotel booking not found');

    // COMPLETED, or CONFIRMED whose check-out date has passed (the worker has just not flipped it yet)
    const stayFinished =
      booking.status === HotelBookingStatus.COMPLETED ||
      (booking.status === HotelBookingStatus.CONFIRMED &&
        booking.checkOutDate < todayUtc());
    if (!stayFinished) {
      throw fieldBadRequest(
        'bookingId',
        'Only COMPLETED reservations (check-out date passed) can be reviewed',
      );
    }
    if (await this.reviewModel.exists({ bookingId: booking._id }).exec()) {
      throw new ConflictException('This reservation has already been reviewed');
    }

    let review: HotelReviewDocument;
    try {
      review = await this.reviewModel.create({
        hotelId: booking.hotelId,
        userId: booking.userId,
        bookingId: booking._id,
        rating: dto.rating,
        comment: dto.comment?.trim() || undefined,
      });
    } catch (err) {
      rethrowDuplicate(err, 'This reservation has already been reviewed'); // unique bookingId index
    }
    await this.recalculateHotelRating(booking.hotelId);
    return review;
  }

  private async getOwn(user: AuthenticatedUser, id: string) {
    const review = await this.reviewModel.findById(oid(id, 'id')).exec();
    if (!review || String(review.userId) !== user.userId)
      throw new NotFoundException('Review not found');
    return review;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateHotelReviewDto) {
    if (dto.rating === undefined && dto.comment === undefined)
      throw fieldBadRequest('rating', 'Nothing to update');
    const review = await this.getOwn(user, id);
    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.comment !== undefined)
      review.comment = dto.comment.trim() || undefined;
    await review.save();
    await this.recalculateHotelRating(review.hotelId);
    return review;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const review = await this.getOwn(user, id);
    await review.deleteOne();
    await this.recalculateHotelRating(review.hotelId);
    return { deleted: true, id };
  }

  /** HTL-26 (bonus): only the moderator assigned to the review's hotel can reply. */
  async reply(user: AuthenticatedUser, id: string, dto: ReplyReviewDto) {
    const review = await this.reviewModel
      .findOne({
        _id: oid(id, 'id'),
        moderationState: ReviewModerationState.VISIBLE,
      })
      .exec();
    if (!review) throw new NotFoundException('Review not found');
    await this.hotels.assertManagesHotel(user, String(review.hotelId));
    review.reply = {
      body: dto.body.trim(),
      moderatorId: oid(user.userId),
      repliedAt: new Date(),
    };
    await review.save();
    return review;
  }

  /** HTL-24: average, count and newest-first paginated VISIBLE reviews. */
  async listForHotel(hotelId: string, page: number) {
    const hotel = await this.hotels.getActiveHotelOrThrow(hotelId);
    const filter = {
      hotelId: hotel._id,
      moderationState: ReviewModerationState.VISIBLE,
    };
    const [items, total, agg] = await Promise.all([
      this.reviewModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
      this.reviewModel.countDocuments(filter).exec(),
      this.aggregate(hotel._id),
    ]);
    const users = await this.userBriefs(items.map((r) => r.userId));
    return {
      ratingAverage: agg.ratingAverage,
      ratingCount: agg.ratingCount,
      ...new PageDto(
        items.map((r) => {
          const u = users.get(String(r.userId));
          return {
            id: r._id,
            rating: r.rating,
            comment: r.comment,
            reply: r.reply
              ? { body: r.reply.body, repliedAt: r.reply.repliedAt }
              : undefined,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            author: {
              name: !u || u.status === 'DEACTIVATED' ? 'Deleted user' : u.name,
            }, // ACC-12
          };
        }),
        PageMetaDto.create(page, total),
      ),
    };
  }

  /** Review authors come from UsersService, never from the User model. */
  private async userBriefs(ids: Types.ObjectId[]) {
    const entries = await Promise.all(
      ids.map(async (id) => {
        const profile = await this.users.findById(String(id));
        return [String(id), profile] as const;
      }),
    );
    return new Map(entries);
  }

  private async aggregate(hotelId: Types.ObjectId) {
    const [row] = await this.reviewModel
      .aggregate([
        { $match: { hotelId, moderationState: ReviewModerationState.VISIBLE } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      .exec();
    return {
      ratingAverage: row ? Math.round(row.avg * 100) / 100 : 0,
      ratingCount: row ? row.count : 0,
    };
  }

  /**
   * GEN-09, GEN-10 (D2): a review as moderation sees it, in any state. Added
   * so the moderation module never reads the reviews collection itself.
   */
  async findForModeration(id: string): Promise<ModeratedContent | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const review = await this.reviewModel.findById(id).lean().exec();
    if (!review) return null;
    return {
      id,
      ownerId: String(review.userId),
      moderationState: review.moderationState as unknown as ModerationState,
      reportable: review.moderationState === ReviewModerationState.VISIBLE,
      preview: review.comment?.slice(0, 120) || `Rating ${review.rating}/5`,
    };
  }

  /**
   * GEN-10 (D2): hide, restore or delete a review on an admin's decision, then
   * recompute the hotel's rating, because only VISIBLE reviews count (HTL-24).
   * Deleting is soft: the row keeps moderationState DELETED.
   */
  async moderate(
    id: string,
    to: ModerationState,
    actorId: string,
  ): Promise<ModerationResult | null> {
    const result = await applyModeration(
      this.reviewModel as never,
      id,
      to,
      actorId,
    );
    if (result?.changed) {
      const review = await this.reviewModel
        .findById(id)
        .select('hotelId')
        .lean()
        .exec();
      if (review) await this.recalculateHotelRating(review.hotelId);
    }
    return result;
  }

  /**
   * Recomputes Hotel.ratingAverage / ratingCount from VISIBLE reviews only.
   * EXPORTED: the admin moderation module must call this after hiding / restoring / deleting a review (GEN-10).
   */
  async recalculateHotelRating(hotelId: Types.ObjectId) {
    const { ratingAverage, ratingCount } = await this.aggregate(hotelId);
    await this.hotels.setRatingAggregate(
      String(hotelId),
      ratingAverage,
      ratingCount,
    );
    return { ratingAverage, ratingCount };
  }
}
