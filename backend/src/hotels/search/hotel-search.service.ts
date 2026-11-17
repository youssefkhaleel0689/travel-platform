import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { InventoryService } from '../inventory/inventory.service';
import { HotelsService } from '../hotels.service';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { HotelSearchDto, HotelSortBy, SortOrder } from './dto/hotel-search.dto';
import { parseStay } from '../../common/dates';
import { centsToString, toCents } from '../../common/money';
import { paginateArray } from '../../common/pagination/paginate';

export interface HotelResult {
  hotelId: Types.ObjectId;
  name: string;
  address?: string;
  cityId?: string;
  countryId?: string;
  starClass?: number;
  photo?: unknown;
  ratingAverage: number | null;
  ratingCount: number;
  pricePerNight: string;
  freeRoomCount: number;
  _cents: bigint;
}

@Injectable()
export class HotelSearchService {
  constructor(
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    private readonly inventory: InventoryService,
    private readonly hotels: HotelsService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /** HTL-11 / HTL-12: search + filter + sort active hotels. */
  async search(dto: HotelSearchDto) {
    const { checkIn, checkOut, nights } = parseStay(dto.checkInDate, dto.checkOutDate);

    const minCents = dto.minPricePerNight !== undefined ? toCents(dto.minPricePerNight) : undefined;
    const maxCents = dto.maxPricePerNight !== undefined ? toCents(dto.maxPricePerNight) : undefined;
    if (minCents !== undefined && maxCents !== undefined && minCents > maxCents) {
      throw new BadRequestException('minPricePerNight cannot be greater than maxPricePerNight');
    }

    // 1. seeded ids, validated by ReferenceDataService, -> ACTIVE hotels
    if (!dto.cityId && !dto.countryId) {
      throw new BadRequestException({
        code: 'DESTINATION_REQUIRED',
        message: 'Provide cityId or countryId',
      });
    }
    if (dto.cityId) await this.referenceData.assertCityExists(dto.cityId);
    if (dto.countryId) await this.referenceData.assertCountriesExist([dto.countryId]);

    const hotels = await this.hotels.findActiveByCityOrCountry(
      dto.cityId ? [dto.cityId] : [],
      dto.countryId ? [dto.countryId] : [],
    );
    if (!hotels.length) return { nights, ...paginateArray([], dto.page) };

    // 2. active rooms of those hotels that are free for the WHOLE stay
    const rooms = await this.roomModel.find({ hotelId: { $in: hotels.map((h) => h._id) }, isActive: true }).lean().exec();
    const status = await this.inventory.evaluateRooms(rooms.map((r) => r._id), checkIn, checkOut);

    const freeByHotel = new Map<string, typeof rooms>();
    for (const r of rooms) {
      if (!status.get(String(r._id))?.free) continue;
      const k = String(r.hotelId);
      (freeByHotel.get(k) ?? freeByHotel.set(k, []).get(k)!).push(r);
    }

    // 3. qualify: enough free rooms AND combined max occupancy of the best `roomCount` rooms covers the guests
    const results: HotelResult[] = [];
    for (const h of hotels) {
      const free = freeByHotel.get(String(h._id)) ?? [];
      if (free.length < dto.roomCount) continue;
      const capacity = [...free].sort((a, b) => b.maxOccupancy - a.maxOccupancy)
        .slice(0, dto.roomCount).reduce((sum, r) => sum + r.maxOccupancy, 0);
      if (capacity < dto.guestCount) continue;

      const cheapest = free.map((r) => toCents(r.pricePerNight)).reduce((a, b) => (b < a ? b : a));
      if (minCents !== undefined && cheapest < minCents) continue;
      if (maxCents !== undefined && cheapest > maxCents) continue;

      const rated = (h.ratingCount ?? 0) > 0;
      const average = h.ratingAverage ?? 0;
      if (dto.minAverageRating !== undefined && !(rated && average >= dto.minAverageRating)) continue; // unrated excluded

      results.push({
        hotelId: h._id, name: h.name, address: h.address, cityId: h.cityId, countryId: h.countryId, starClass: h.starClass,
        photo: Array.isArray(h.photos) ? h.photos[0] : undefined,
        ratingAverage: rated ? average : null,
        ratingCount: h.ratingCount ?? 0,
        pricePerNight: centsToString(cheapest),
        freeRoomCount: free.length,
        _cents: cheapest,
      });
    }

    // 4. sort (price asc by default; rating desc by default), stable tie-break on name
    const byRating = dto.sortBy === HotelSortBy.RATING;
    const dir = (dto.sortOrder ?? (byRating ? SortOrder.DESC : SortOrder.ASC)) === SortOrder.ASC ? 1 : -1;
    results.sort((a, b) => {
      const av = byRating ? (a.ratingAverage ?? -1) : Number(a._cents);
      const bv = byRating ? (b.ratingAverage ?? -1) : Number(b._cents);
      return av === bv ? String(a.name).localeCompare(String(b.name)) : (av - bv) * dir;
    });

    const all = results.map(({ _cents, ...rest }) => rest);
    return {
      checkInDate: checkIn,
      checkOutDate: checkOut,
      nights,
      guestCount: dto.guestCount,
      roomCount: dto.roomCount,
      ...paginateArray(all, dto.page),
    };
  }
}
