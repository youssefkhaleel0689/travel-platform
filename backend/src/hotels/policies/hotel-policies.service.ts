import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HotelPolicy, HotelPolicyDocument } from './schemas/hotel-policy.schema';
import { UpsertHotelPolicyDto } from './dto/upsert-hotel-policy.dto';
import { HotelsService } from '../hotels.service';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DEFAULT_CHECK_IN_TIME, DEFAULT_CHECK_OUT_TIME } from '../../common/constants';
import { oid, rethrowDuplicate } from '../../common/mongo';

export interface PolicySnapshot {
  policyVersion: number;
  checkInTime: string;
  checkOutTime: string;
  cancellationTiers: { daysBeforeCheckIn: number; refundPercentage: number }[];
}

@Injectable()
export class HotelPoliciesService {
  constructor(
    @InjectModel(HotelPolicy.name) private readonly policyModel: Model<HotelPolicyDocument>,
    private readonly hotels: HotelsService,
  ) {}

  /** HTL-09 / HTL-10: only the assigned moderator may change the policy; version increments atomically. */
  async upsert(user: AuthenticatedUser, hotelId: string, dto: UpsertHotelPolicyDto) {
    const hotel = await this.hotels.assertModeratorOwnsHotel(user, hotelId);

    const thresholds = dto.cancellationTiers.map((t) => t.daysBeforeCheckIn);
    if (new Set(thresholds).size !== thresholds.length) {
      throw new BadRequestException('Cancellation tier day thresholds must be unique');
    }
    const tiers = [...dto.cancellationTiers]
      .sort((a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn)
      .map((t) => ({ daysBeforeCheckIn: t.daysBeforeCheckIn, refundPercentage: t.refundPercentage }));

    try {
      return await this.policyModel
        .findOneAndUpdate(
          { hotelId: hotel._id },
          {
            $set: {
              checkInTime: dto.checkInTime,
              checkOutTime: dto.checkOutTime,
              cancellationTiers: tiers,
              updatedBy: new Types.ObjectId(user.userId),
            },
            $inc: { version: 1 }, // atomic; creates version = 1 on first insert
          },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: false },
        )
        .exec();
    } catch (err) {
      rethrowDuplicate(err, 'Concurrent policy update, please retry');
    }
  }

  /** Public read (hotel details page HTL-02). Returns defaults when the moderator has not configured a policy yet. */
  async findByHotel(hotelId: string) {
    const hotel = await this.hotels.getActiveHotelOrThrow(hotelId);
    const policy = await this.policyModel.findOne({ hotelId: hotel._id }).exec();
    if (policy) return policy;
    return {
      hotelId: hotel._id,
      checkInTime: DEFAULT_CHECK_IN_TIME,
      checkOutTime: DEFAULT_CHECK_OUT_TIME,
      cancellationTiers: [],
      version: 0,
      isDefault: true,
    };
  }

  /** Exact policy to snapshot onto a reservation (used by HotelBookingsService, shown before payment PAY-02). */
  async getSnapshot(hotelId: Types.ObjectId | string, session?: import('mongoose').ClientSession): Promise<PolicySnapshot> {
    const policy = await this.policyModel
      .findOne({ hotelId: typeof hotelId === 'string' ? oid(hotelId) : hotelId })
      .session(session ?? null)
      .lean()
      .exec();
    if (!policy) {
      return { policyVersion: 0, checkInTime: DEFAULT_CHECK_IN_TIME, checkOutTime: DEFAULT_CHECK_OUT_TIME, cancellationTiers: [] };
    }
    return {
      policyVersion: policy.version,
      checkInTime: policy.checkInTime,
      checkOutTime: policy.checkOutTime,
      cancellationTiers: (policy.cancellationTiers ?? []).map((t) => ({
        daysBeforeCheckIn: t.daysBeforeCheckIn,
        refundPercentage: t.refundPercentage,
      })),
    };
  }
}
