import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Room, RoomDocument } from './schemas/room.schema';
import { Availability, AvailabilityDocument } from '../availability/schemas/availability.schema';
import { HotelBooking, HotelBookingDocument } from '../hotel-bookings/schemas/hotel-booking.schema';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { InventoryService } from '../inventory/inventory.service';
import { ExternalModelsService } from '../common/external-models.service';
import { AuthUser } from '../common/auth/auth-user';
import { oid, rethrowDuplicate } from '../common/mongo';
import { centsToDecimal128, centsToString, toCents } from '../common/money';
import { parseStay, todayUtc } from '../common/dates';
import { PageDto, PageMetaDto } from '../common/pagination/dto/page.dto';
import { PAGE_SIZE } from '../common/pagination/pagination.constants';

const FAR_FUTURE = new Date('9999-12-31T00:00:00.000Z');

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(Availability.name) private readonly availabilityModel: Model<AvailabilityDocument>,
    @InjectModel(HotelBooking.name) private readonly bookingModel: Model<HotelBookingDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: InventoryService,
    private readonly external: ExternalModelsService,
  ) {}

  /** HTL-03 */
  async create(user: AuthUser, hotelId: string, dto: CreateRoomDto) {
    const hotel = await this.external.assertCanManageHotel(user, hotelId);
    try {
      return await this.roomModel.create({
        hotelId: hotel._id,
        roomNumber: dto.roomNumber.trim(),
        name: dto.name.trim(),
        type: dto.type.trim(),
        beds: dto.beds,
        maxOccupancy: dto.maxOccupancy,
        pricePerNight: centsToDecimal128(toCents(dto.pricePerNight)),
      });
    } catch (err) {
      rethrowDuplicate(err, 'Room number and room name must be unique within the hotel');
    }
  }

  async findByHotel(user: AuthUser, hotelId: string, page: number) {
    const hotel = await this.external.assertCanManageHotel(user, hotelId, true);
    const filter = { hotelId: hotel._id };
    const [items, total] = await Promise.all([
      this.roomModel.find(filter).sort({ roomNumber: 1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).exec(),
      this.roomModel.countDocuments(filter).exec(),
    ]);
    return new PageDto(items, PageMetaDto.create(page, total));
  }

  async findOne(user: AuthUser, hotelId: string, roomId: string) {
    await this.external.assertCanManageHotel(user, hotelId, true);
    return this.getRoomOfHotel(hotelId, roomId);
  }

  /** Room must exist AND belong to the hotel in the URL. */
  async getRoomOfHotel(hotelId: string, roomId: string): Promise<RoomDocument> {
    const room = await this.roomModel.findOne({ _id: oid(roomId, 'roomId'), hotelId: oid(hotelId, 'hotelId') }).exec();
    if (!room) throw new NotFoundException('Room not found in this hotel');
    return room;
  }

  /** HTL-05: edit beds, occupancy, price (and other attributes). Existing reservations keep their snapshot. */
  async update(user: AuthUser, hotelId: string, roomId: string, dto: UpdateRoomDto) {
    await this.external.assertCanManageHotel(user, hotelId);
    const room = await this.getRoomOfHotel(hotelId, roomId);

    const set: Record<string, unknown> = {};
    if (dto.roomNumber !== undefined) set.roomNumber = dto.roomNumber.trim();
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.type !== undefined) set.type = dto.type.trim();
    if (dto.beds !== undefined) set.beds = dto.beds;
    if (dto.maxOccupancy !== undefined) set.maxOccupancy = dto.maxOccupancy;
    if (dto.pricePerNight !== undefined) {
      set.pricePerNight = centsToDecimal128(toCents(dto.pricePerNight));
    }

    try {
      if (dto.isActive === false && room.isActive) {
        return await this.setActive(room._id, false, set);
      }
      if (dto.isActive === true) set.isActive = true;
      const updated = await this.roomModel
        .findByIdAndUpdate(room._id, { $set: set }, { new: true, runValidators: true })
        .exec();
      if (!updated) throw new NotFoundException('Room not found');
      return updated;
    } catch (err) {
      rethrowDuplicate(err, 'Room number and room name must be unique within the hotel');
    }
  }

  async deactivate(user: AuthUser, hotelId: string, roomId: string) {
    await this.external.assertCanManageHotel(user, hotelId);
    const room = await this.getRoomOfHotel(hotelId, roomId);
    return this.setActive(room._id, false, {});
  }

  async activate(user: AuthUser, hotelId: string, roomId: string) {
    await this.external.assertCanManageHotel(user, hotelId);
    const room = await this.getRoomOfHotel(hotelId, roomId);
    const updated = await this.roomModel.findByIdAndUpdate(room._id, { $set: { isActive: true } }, { new: true }).exec();
    return updated!;
  }

  /** HTL-06: deactivation is rejected when it overlaps a CONFIRMED or (unexpired) PENDING_PAYMENT reservation. */
  private setActive(roomId: Types.ObjectId, active: boolean, extra: Record<string, unknown>) {
    return this.connection.transaction(async (session: ClientSession) => {
      await this.inventory.lockRooms([roomId], session);
      if (!active) {
        const blocking = await this.inventory.findConsumingBookings([roomId], todayUtc(), FAR_FUTURE, { session });
        if (blocking.length) {
          throw new BadRequestException(
            'Room cannot be deactivated while it has an upcoming CONFIRMED or PENDING_PAYMENT reservation',
          );
        }
      }
      const updated = await this.roomModel
        .findByIdAndUpdate(roomId, { $set: { ...extra, isActive: active } }, { new: true, runValidators: true, session })
        .exec();
      if (!updated) throw new NotFoundException('Room not found');
      return updated;
    });
  }

  /** HTL-06: delete only if the room has never been reserved (an EXPIRED hold is still a reservation record). */
  async remove(user: AuthUser, hotelId: string, roomId: string) {
    await this.external.assertCanManageHotel(user, hotelId);
    const room = await this.getRoomOfHotel(hotelId, roomId);

    return this.connection.transaction(async (session: ClientSession) => {
      await this.inventory.lockRooms([room._id], session);
      const everReserved = await this.bookingModel
        .exists({ 'roomsSnapshot.roomId': room._id })
        .session(session)
        .exec();
      if (everReserved) {
        throw new BadRequestException('A room that has been reserved cannot be deleted; deactivate it instead');
      }
      await this.availabilityModel.deleteMany({ roomId: room._id }, { session }).exec();
      await this.roomModel.deleteOne({ _id: room._id }, { session }).exec();
      return { deleted: true, id: String(room._id) };
    });
  }

  /** HTL-15: all active rooms of an active hotel that are free for the whole stay, with total stay price. */
  async findAvailable(hotelId: string, checkInDate: string, checkOutDate: string) {
    const { checkIn, checkOut, nights } = parseStay(checkInDate, checkOutDate);
    const hotel = await this.external.getBookableHotel(hotelId);
    const rooms = await this.roomModel.find({ hotelId: hotel._id, isActive: true }).sort({ pricePerNight: 1, roomNumber: 1 }).exec();
    const status = await this.inventory.evaluateRooms(rooms.map((r) => r._id), checkIn, checkOut);

    const items = rooms
      .filter((r) => status.get(String(r._id))?.free)
      .map((r) => {
        const perNight = toCents(r.pricePerNight);
        return {
          roomId: r._id,
          roomNumber: r.roomNumber,
          name: r.name,
          type: r.type,
          beds: r.beds,
          maxOccupancy: r.maxOccupancy,
          pricePerNight: centsToString(perNight),
          nights,
          totalStayPrice: centsToString(perNight * BigInt(nights)),
        };
      });
    return { hotelId: hotel._id, checkInDate: checkIn, checkOutDate: checkOut, nights, rooms: items };
  }
}
