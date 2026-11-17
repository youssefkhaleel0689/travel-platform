import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Availability, AvailabilityDocument, AvailabilityStatus } from './schemas/availability.schema';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { CreateAvailabilityDto, RoomStatusQueryDto, UpdateAvailabilityDto } from './dto/availability.dto';
import { InventoryService } from '../inventory/inventory.service';
import { HotelsService } from '../hotel-core/hotels.service';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { addDays, DAY_MS, parseDateOnly, toDateKey } from '../common/dates';
import { oid } from '../common/mongo';
import { removedParts } from '../common/ranges';
import { MAX_STATUS_VIEW_NIGHTS } from '../common/constants';

type Range = { startDate: Date; endDate: Date };

export interface RoomSegment {
  status: string;
  startDate: Date;
  endDate: Date;
  bookingId?: string;
  bookingReference?: string | null;
  bookingStatus?: string;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectModel(Availability.name) private readonly availabilityModel: Model<AvailabilityDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: InventoryService,
    private readonly hotels: HotelsService,
  ) {}

  private async getRoom(hotelId: string, roomId: string) {
    const room = await this.roomModel.findOne({ _id: oid(roomId, 'roomId'), hotelId: oid(hotelId, 'hotelId') }).exec();
    if (!room) throw new NotFoundException('Room not found in this hotel'); // also verifies room belongs to hotel
    return room;
  }

  private parseRange(start: string, end: string): Range {
    const startDate = parseDateOnly(start, 'startDate');
    const endDate = parseDateOnly(end, 'endDate');
    if (endDate <= startDate) throw new BadRequestException('endDate must be later than startDate');
    return { startDate, endDate };
  }

  /** HTL-04 / HTL-06 rules for one range, evaluated inside the room's lock. */
  private async assertRangeAllowed(
    roomId: Types.ObjectId,
    range: Range,
    status: AvailabilityStatus,
    session: ClientSession,
    excludeId?: Types.ObjectId,
  ) {
    const sameStatusOverlap = await this.availabilityModel
      .exists({
        roomId,
        status,
        startDate: { $lt: range.endDate },
        endDate: { $gt: range.startDate },
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      })
      .session(session)
      .exec();
    if (sameStatusOverlap) {
      throw new BadRequestException(`Overlapping ${status} range exists for this room`);
    }
    // A BLOCKED range may lie inside an AVAILABLE one (blocked takes precedence), but may not touch a reservation.
    if (status === AvailabilityStatus.BLOCKED) {
      if (await this.inventory.hasConsumingBooking(roomId, range.startDate, range.endDate, session)) {
        throw new BadRequestException('Cannot block dates that overlap a CONFIRMED or PENDING_PAYMENT reservation');
      }
    }
  }

  private async assertNothingBookedIn(roomId: Types.ObjectId, parts: Range[], session: ClientSession) {
    for (const p of parts) {
      if (await this.inventory.hasConsumingBooking(roomId, p.startDate, p.endDate, session)) {
        throw new BadRequestException('Availability cannot be removed for dates that have reservations');
      }
    }
  }

  async create(user: AuthenticatedUser, hotelId: string, roomId: string, dto: CreateAvailabilityDto) {
    const hotel = await this.hotels.assertModeratorOwnsHotel(user, hotelId);
    const room = await this.getRoom(hotelId, roomId);
    const range = this.parseRange(dto.startDate, dto.endDate);

    return this.connection.transaction(async (session: ClientSession) => {
      await this.inventory.lockRooms([room._id], session);
      await this.assertRangeAllowed(room._id, range, dto.status, session);
      const [created] = await this.availabilityModel.create(
        [{ hotelId: hotel._id, roomId: room._id, ...range, status: dto.status, createdBy: new Types.ObjectId(user.userId) }],
        { session },
      );
      return created;
    });
  }

  async findForRoom(user: AuthenticatedUser, hotelId: string, roomId: string) {
    await this.hotels.assertModeratorOwnsHotel(user, hotelId, true);
    const room = await this.getRoom(hotelId, roomId);
    return this.availabilityModel.find({ roomId: room._id }).sort({ startDate: 1 }).exec();
  }

  /** HTL-05: update an existing availability/blocked range. */
  async update(user: AuthenticatedUser, hotelId: string, roomId: string, dto: UpdateAvailabilityDto) {
    await this.hotels.assertModeratorOwnsHotel(user, hotelId);
    const room = await this.getRoom(hotelId, roomId);

    return this.connection.transaction(async (session: ClientSession) => {
      await this.inventory.lockRooms([room._id], session);
      const current = await this.availabilityModel
        .findOne({ _id: oid(dto.availabilityId, 'availabilityId'), roomId: room._id })
        .session(session)
        .exec();
      if (!current) throw new NotFoundException('Availability record not found for this room');

      const next: Range = this.parseRange(
        dto.startDate ?? toDateKey(current.startDate),
        dto.endDate ?? toDateKey(current.endDate),
      );
      const nextStatus = dto.status ?? current.status;

      if (current.status === AvailabilityStatus.AVAILABLE) {
        const lost = nextStatus === AvailabilityStatus.AVAILABLE ? removedParts(current, next) : [current];
        await this.assertNothingBookedIn(room._id, lost, session);
      }
      await this.assertRangeAllowed(room._id, next, nextStatus, session, current._id);

      current.startDate = next.startDate;
      current.endDate = next.endDate;
      current.status = nextStatus;
      await current.save({ session });
      return current;
    });
  }

  async remove(user: AuthenticatedUser, hotelId: string, roomId: string, availabilityId: string) {
    await this.hotels.assertModeratorOwnsHotel(user, hotelId);
    const room = await this.getRoom(hotelId, roomId);

    return this.connection.transaction(async (session: ClientSession) => {
      await this.inventory.lockRooms([room._id], session);
      const record = await this.availabilityModel
        .findOne({ _id: oid(availabilityId, 'availabilityId'), roomId: room._id })
        .session(session)
        .exec();
      if (!record) throw new NotFoundException('Availability record not found for this room');
      if (record.status === AvailabilityStatus.AVAILABLE) {
        await this.assertNothingBookedIn(room._id, [record], session);
      }
      await record.deleteOne({ session });
      return { deleted: true, id: availabilityId };
    });
  }

  /**
   * HTL-08: per-room status for a date range: AVAILABLE | BOOKED (with reservation reference) | BLOCKED.
   * Nights where no availability range was ever defined are simply not listed (the room is not offered then).
   */
  async roomStatusView(user: AuthenticatedUser, hotelId: string, q: RoomStatusQueryDto) {
    const hotel = await this.hotels.assertModeratorOwnsHotel(user, hotelId, true);
    const from = parseDateOnly(q.startDate, 'startDate');
    const to = parseDateOnly(q.endDate, 'endDate');
    if (to <= from) throw new BadRequestException('endDate must be after startDate');
    const nights = Math.round((to.getTime() - from.getTime()) / DAY_MS);
    if (nights > MAX_STATUS_VIEW_NIGHTS) throw new BadRequestException(`Date range cannot exceed ${MAX_STATUS_VIEW_NIGHTS} nights`);

    const rooms = await this.roomModel.find({ hotelId: hotel._id }).sort({ roomNumber: 1 }).exec();
    const roomIds = rooms.map((r) => r._id);
    const [ranges, bookings] = await Promise.all([
      this.inventory.fetchRanges(roomIds, from, to),
      this.inventory.findConsumingBookings(roomIds, from, to, { includeCompleted: true }),
    ]);

    return {
      hotelId: hotel._id,
      startDate: from,
      endDate: to,
      rooms: rooms.map((room) => {
        const key = String(room._id);
        const myRanges = ranges.filter((r) => String(r.roomId) === key);
        const myBookings = bookings.filter((b) => b.roomsSnapshot.some((s) => String(s.roomId) === key));

        const segments: RoomSegment[] = [];
        for (let d = from; d < to; d = addDays(d, 1)) {
          let status: string | null = null;
          let booking: (typeof myBookings)[number] | undefined;
          booking = myBookings.find((b) => b.checkInDate <= d && b.checkOutDate > d);
          if (booking) status = 'BOOKED';
          else if (myRanges.some((r) => r.status === AvailabilityStatus.BLOCKED && r.startDate <= d && r.endDate > d)) status = 'BLOCKED';
          else if (myRanges.some((r) => r.status === AvailabilityStatus.AVAILABLE && r.startDate <= d && r.endDate > d)) status = 'AVAILABLE';
          if (!status) continue;

          const ref = booking ? String(booking._id) : undefined;
          const last = segments[segments.length - 1];
          if (last && last.status === status && last.bookingId === ref && last.endDate.getTime() === d.getTime()) {
            last.endDate = addDays(d, 1);
          } else {
            segments.push({
              status,
              startDate: d,
              endDate: addDays(d, 1),
              ...(booking && {
                bookingId: ref,
                bookingReference: booking.bookingReference ?? null,
                bookingStatus: booking.status,
              }),
            });
          }
        }
        return { roomId: room._id, roomNumber: room.roomNumber, name: room.name, isActive: room.isActive, segments };
      }),
    };
  }
}
