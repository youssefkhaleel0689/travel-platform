import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, QueryFilter, Model, Types } from 'mongoose';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { Availability, AvailabilityDocument, AvailabilityStatus } from '../availability/schemas/availability.schema';
import { HotelBooking, HotelBookingDocument, HotelBookingStatus } from '../hotel-bookings/schemas/hotel-booking.schema';
import { isFullyCovered, overlaps } from '../common/ranges';

export type RoomFreeResult =
  | { free: true }
  | { free: false; reason: 'NOT_AVAILABLE' | 'BLOCKED' | 'BOOKED'; bookingReference?: string };

/**
 * Single place that answers "is this room free for these nights?".
 * Used by search (HTL-11/15), booking holds (HTL-18), availability edits (HTL-05/06) and the moderator view (HTL-08).
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(Availability.name) private readonly availabilityModel: Model<AvailabilityDocument>,
    @InjectModel(HotelBooking.name) private readonly bookingModel: Model<HotelBookingDocument>,
  ) {}

  /**
   * Bookings that currently consume room inventory: CONFIRMED, or PENDING_PAYMENT whose hold has NOT expired.
   * Expired holds never block anyone, so correctness does not depend on the expiry worker having run.
   */
  private consumingFilter(now: Date, includeCompleted: boolean): QueryFilter<HotelBookingDocument>[] {
    const clauses: QueryFilter<HotelBookingDocument>[] = [
      { status: HotelBookingStatus.CONFIRMED },
      { status: HotelBookingStatus.PENDING_PAYMENT, holdExpiresAt: { $gt: now } },
    ];
    if (includeCompleted) clauses.push({ status: HotelBookingStatus.COMPLETED });
    return clauses;
  }

  findConsumingBookings(
    roomIds: Types.ObjectId[],
    from: Date,
    to: Date,
    opts: { session?: ClientSession; excludeBookingId?: Types.ObjectId; includeCompleted?: boolean } = {},
  ) {
    const filter: QueryFilter<HotelBookingDocument> = {
      'roomsSnapshot.roomId': { $in: roomIds },
      checkInDate: { $lt: to },
      checkOutDate: { $gt: from },
      $or: this.consumingFilter(new Date(), !!opts.includeCompleted),
    };
    if (opts.excludeBookingId) filter._id = { $ne: opts.excludeBookingId };
    return this.bookingModel.find(filter).session(opts.session ?? null).lean().exec();
  }

  async hasConsumingBooking(roomId: Types.ObjectId, from: Date, to: Date, session?: ClientSession): Promise<boolean> {
    const found = await this.findConsumingBookings([roomId], from, to, { session });
    return found.length > 0;
  }

  /**
   * Serialises concurrent transactions touching the same rooms. Incrementing a field on the Room documents
   * makes two overlapping transactions conflict (WriteConflict); MongoDB aborts one and `withTransaction`
   * retries it, so it then sees the other's committed booking and is rejected. Ordinary unique indexes cannot
   * enforce date-range overlap, which is why this is needed (schema: "Use transaction/conflict check").
   */
  async lockRooms(roomIds: Types.ObjectId[], session: ClientSession) {
    await this.roomModel.updateMany({ _id: { $in: roomIds } }, { $inc: { lockVersion: 1 } }, { session }).exec();
  }

  /** Per-room free/not-free result for the nights [from, to). */
  async evaluateRooms(
    roomIds: Types.ObjectId[],
    from: Date,
    to: Date,
    opts: { session?: ClientSession; excludeBookingId?: Types.ObjectId } = {},
  ): Promise<Map<string, RoomFreeResult>> {
    const result = new Map<string, RoomFreeResult>();
    if (!roomIds.length) return result;

    const [ranges, bookings] = await Promise.all([
      this.availabilityModel
        .find({ roomId: { $in: roomIds }, startDate: { $lt: to }, endDate: { $gt: from } })
        .session(opts.session ?? null)
        .lean()
        .exec(),
      this.findConsumingBookings(roomIds, from, to, opts),
    ]);

    for (const id of roomIds) {
      const key = String(id);
      const mine = ranges.filter((r) => String(r.roomId) === key);
      const available = mine.filter((r) => r.status === AvailabilityStatus.AVAILABLE);
      const blocked = mine.filter((r) => r.status === AvailabilityStatus.BLOCKED);
      const booking = bookings.find((b) => b.roomsSnapshot.some((s) => String(s.roomId) === key));

      if (booking) result.set(key, { free: false, reason: 'BOOKED', bookingReference: booking.bookingReference });
      else if (blocked.some((r) => overlaps(r, { startDate: from, endDate: to }))) result.set(key, { free: false, reason: 'BLOCKED' });
      else if (!isFullyCovered(available, from, to)) result.set(key, { free: false, reason: 'NOT_AVAILABLE' });
      else result.set(key, { free: true });
    }
    return result;
  }

  fetchRanges(roomIds: Types.ObjectId[], from: Date, to: Date) {
    return this.availabilityModel
      .find({ roomId: { $in: roomIds }, startDate: { $lt: to }, endDate: { $gt: from } })
      .lean()
      .exec();
  }
}
