import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { Role } from '../common/auth/auth.enums';
import { oid, rethrowDuplicate } from '../common/mongo';
import {
  HotelModeratorAssignment,
} from './schemas/hotel-moderator-assignment.schema';
import { Hotel, HotelStatus } from './schemas/hotel.schema';

/** The hotel fields other B2 modules are allowed to see. */
export interface HotelBrief {
  _id: Types.ObjectId;
  name: string;
  status?: HotelStatus;
  cityId?: string;
  countryId?: string;
  address?: string;
  starClass?: number;
  photos?: unknown[];
  ratingAverage?: number | null;
  ratingCount?: number;
}

function hotelNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'HOTEL_NOT_FOUND',
    message: 'Hotel not found',
  });
}

/**
 * HTL-01. Owns the Hotel and HotelModeratorAssignment models. Other modules
 * use this service; they never inject either model (README module conventions).
 */
@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectModel(HotelModeratorAssignment.name)
    private readonly assignmentModel: Model<HotelModeratorAssignment>,
  ) {}

  /** A public read of an active hotel: a deactivated hotel is not bookable. */
  async getActiveHotelOrThrow(hotelId: string): Promise<HotelBrief> {
    const hotel = await this.hotelModel.findById(oid(hotelId, 'hotelId')).lean<Hotel>().exec();
    if (!hotel || hotel.status !== HotelStatus.ACTIVE) throw hotelNotFound();
    return hotel as HotelBrief;
  }

  /** Internal read used by moderator paths: a deactivated hotel must stay manageable. */
  private async getHotelOrThrow(hotelId: string): Promise<HotelBrief> {
    const hotel = await this.hotelModel.findById(oid(hotelId, 'hotelId')).lean<Hotel>().exec();
    if (!hotel) throw hotelNotFound();
    return hotel as HotelBrief;
  }

  /**
   * The moderator link lives only in hotelModeratorAssignment (ACC-11).
   * ADMIN may pass when `allowAdmin` is set (read-only dashboards).
   */
  async assertModeratorOwnsHotel(
    user: AuthenticatedUser,
    hotelId: string,
    allowAdmin = false,
  ): Promise<HotelBrief> {
    const hotel = await this.getHotelOrThrow(hotelId);
    if (allowAdmin && user.role === Role.ADMIN) return hotel;
    if (user.role !== Role.HOTEL_MODERATOR) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the hotel moderator can do this',
      });
    }
    const assignment = await this.assignmentModel
      .exists({ moderatorId: oid(user.userId), hotelId: hotel._id })
      .exec();
    if (!assignment) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You are not assigned to this hotel',
      });
    }
    return hotel;
  }

  /** The only writer of the moderator link (used by the administration module). */
  async assignModerator(moderatorId: string, hotelId: string): Promise<void> {
    const hotelIdObj = oid(hotelId, 'hotelId');
    const exists = await this.hotelModel.exists({ _id: hotelIdObj }).exec();
    if (!exists) throw hotelNotFound();
    try {
      await this.assignmentModel.create({
        moderatorId: oid(moderatorId, 'moderatorId'),
        hotelId: hotelIdObj,
      });
    } catch (err) {
      rethrowDuplicate(err, 'This moderator is already assigned to a hotel');
    }
  }

  /** Activate / deactivate a hotel (ACC-15). */
  async setStatus(hotelId: string, status: HotelStatus): Promise<HotelBrief> {
    const updated = await this.hotelModel
      .findByIdAndUpdate(
        oid(hotelId, 'hotelId'),
        {
          $set: {
            status,
            deactivatedAt:
              status === HotelStatus.DEACTIVATED ? new Date() : null,
          },
        },
        { new: true, runValidators: true },
      )
      .lean<Hotel>()
      .exec();
    if (!updated) throw hotelNotFound();
    return updated as HotelBrief;
  }

  /** HTL-11: active hotels in the searched seeded city or country. */
  async findActiveByCityOrCountry(
    cityIds: string[],
    countryIds: string[],
  ): Promise<HotelBrief[]> {
    if (!cityIds.length && !countryIds.length) return [];
    const hotels = await this.hotelModel
      .find({
        status: HotelStatus.ACTIVE,
        $or: [
          ...(cityIds.length ? [{ cityId: { $in: cityIds } }] : []),
          ...(countryIds.length ? [{ countryId: { $in: countryIds } }] : []),
        ],
      })
      .lean<Hotel[]>()
      .exec();
    return hotels as HotelBrief[];
  }

  /** Enriches list responses with the hotel name/address without exposing the model. */
  async briefs(ids: Types.ObjectId[]): Promise<Map<string, HotelBrief>> {
    if (!ids.length) return new Map();
    const rows = await this.hotelModel
      .find(
        { _id: { $in: ids } },
        { name: 1, address: 1, cityId: 1, countryId: 1, starClass: 1 },
      )
      .lean<Hotel[]>()
      .exec();
    return new Map(rows.map((row) => [String(row._id), row as HotelBrief]));
  }

  /** HTL-23/24: recalculated by ReviewsService from VISIBLE reviews only. */
  async setRatingAggregate(
    hotelId: Types.ObjectId,
    ratingAverage: number,
    ratingCount: number,
  ): Promise<void> {
    await this.hotelModel
      .updateOne(
        { _id: hotelId },
        { $set: { ratingAverage, ratingCount } },
      )
      .exec();
  }
}
