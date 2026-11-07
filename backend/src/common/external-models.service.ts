import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { EXTERNAL_MODELS, Role } from './constants';
import { AuthUser } from './auth/auth-user';
import { oid } from './mongo';

export interface HotelBrief {
  _id: Types.ObjectId;
  name: string;
  status?: string;
  cityId?: string; // reference data ids are the seeded string ids (e.g. "cairo", "EG")
  countryId?: string;
  address?: string;
  starClass?: number;
  photos?: unknown[];
  ratingAverage?: number;
  ratingCount?: number;
}

export interface UserBrief {
  _id: Types.ObjectId;
  name?: string;
  email?: string;
  status?: string;
}

type ExternalDoc = Record<string, unknown>;

/**
 * Thin read/write access to models owned by other modules (Hotel, HotelModeratorAssignment, User, City, Country).
 * It uses the shared Mongoose connection, so B2 never registers a second (conflicting) schema for them.
 */
@Injectable()
export class ExternalModelsService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  model(name: string): Model<ExternalDoc> {
    const m = this.connection.models[name];
    if (!m) {
      throw new InternalServerErrorException(
        `Model "${name}" is not registered on the Mongoose connection. B2 expects it from another module (see README).`,
      );
    }
    return m;
  }

  async getHotel(hotelId: string): Promise<HotelBrief> {
    const hotel = await this.model(EXTERNAL_MODELS.HOTEL).findById(oid(hotelId, 'hotelId')).lean().exec();
    if (!hotel) throw new NotFoundException('Hotel not found');
    return hotel as unknown as HotelBrief;
  }

  /** Hotel must exist AND be ACTIVE (deactivated hotels cannot receive new bookings, ACC-15). */
  async getBookableHotel(hotelId: string): Promise<HotelBrief> {
    const hotel = await this.getHotel(hotelId);
    if (hotel.status && hotel.status !== 'ACTIVE') throw new NotFoundException('Hotel is not available');
    return hotel;
  }

  /**
   * Hotel moderator must be assigned to this hotel (single source of truth: hotelModeratorAssignment).
   * ADMIN is allowed only when `allowAdmin` is set (read-only dashboards).
   */
  async assertCanManageHotel(user: AuthUser, hotelId: string, allowAdmin = false): Promise<HotelBrief> {
    const hotel = await this.getHotel(hotelId);
    if (allowAdmin && user.role === Role.ADMIN) return hotel;
    if (user.role !== Role.HOTEL_MODERATOR) throw new ForbiddenException('Only the hotel moderator can do this');
    const assignment = await this.model(EXTERNAL_MODELS.HOTEL_MODERATOR_ASSIGNMENT)
      .exists({ moderatorId: oid(user.userId), hotelId: hotel._id })
      .exec();
    if (!assignment) throw new ForbiddenException('You are not assigned to this hotel');
    return hotel;
  }

  async setHotelRating(hotelId: Types.ObjectId, ratingAverage: number, ratingCount: number) {
    await this.model(EXTERNAL_MODELS.HOTEL).updateOne({ _id: hotelId }, { $set: { ratingAverage, ratingCount } }).exec();
  }

  async hotelBriefs(ids: Types.ObjectId[]): Promise<Map<string, HotelBrief>> {
    if (!ids.length) return new Map();
    const rows = await this.model(EXTERNAL_MODELS.HOTEL)
      .find({ _id: { $in: ids } }, { name: 1, address: 1, cityId: 1, countryId: 1, starClass: 1 })
      .lean<HotelBrief[]>()
      .exec();
    return new Map(rows.map((r) => [String(r._id), r]));
  }

  async userBriefs(ids: Types.ObjectId[]): Promise<Map<string, UserBrief>> {
    if (!ids.length) return new Map();
    const rows = await this.model(EXTERNAL_MODELS.USER)
      .find({ _id: { $in: ids } }, { name: 1, email: 1, status: 1 })
      .lean<UserBrief[]>()
      .exec();
    return new Map(rows.map((r) => [String(r._id), r]));
  }

  /** Resolves a destination to seeded city/country ids by EXACT name (case-insensitive) (HTL-11). */
  async resolveDestination(destination: string): Promise<{ cityIds: string[]; countryIds: string[] }> {
    const escaped = destination.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exact = new RegExp(`^${escaped}$`, 'i');
    const [cities, countries] = await Promise.all([
      this.model(EXTERNAL_MODELS.CITY).find({ name: exact }, { _id: 1 }).lean<{ _id: string }[]>().exec(),
      this.model(EXTERNAL_MODELS.COUNTRY).find({ name: exact }, { _id: 1 }).lean<{ _id: string }[]>().exec(),
    ]);
    return { cityIds: cities.map((c) => c._id), countryIds: countries.map((c) => c._id) };
  }
}
