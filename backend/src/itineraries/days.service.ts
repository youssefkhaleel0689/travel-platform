import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateDayDto, ReorderDaysDto, UpdateDayDto } from './dto/day.dto';
import { ItinerariesService } from './itineraries.service';
import { MAX_DAYS, moveItem } from './itinerary-days.logic';
import { findDayOrThrow } from './itinerary-lookup';
import { toItineraryView } from './itinerary.view';
import { ItineraryDay } from './schemas/itinerary.schema';

@Injectable()
export class DaysService {
  constructor(private readonly itineraries: ItinerariesService) {}

  // ITN-05: a new day goes at the end; its number and date follow from that.
  async addDay(userId: string, id: string, dto: CreateDayDto) {
    const doc = await this.itineraries.findOwnedOrThrow(userId, id);
    if (doc.days.length >= MAX_DAYS) {
      throw new BadRequestException({
        code: 'MAX_DAYS_REACHED',
        message: `An itinerary can have at most ${MAX_DAYS} days`,
      });
    }
    doc.days.push({
      city: dto.city,
      notes: dto.notes,
      activities: [],
      budgetEntries: [],
    } as unknown as ItineraryDay);
    await doc.save();
    return toItineraryView(doc);
  }

  async updateDay(
    userId: string,
    id: string,
    dayId: string,
    dto: UpdateDayDto,
  ) {
    const doc = await this.itineraries.findOwnedOrThrow(userId, id);
    const day = findDayOrThrow(doc, dayId);
    if (dto.city !== undefined) day.city = dto.city;
    if (dto.notes !== undefined) day.notes = dto.notes;
    await doc.save();
    return toItineraryView(doc);
  }

  // ITN-07: later days move up one number and one date automatically, and the
  // day's activities, budget entries and transport costs go with it.
  async deleteDay(userId: string, id: string, dayId: string) {
    const doc = await this.itineraries.findOwnedOrThrow(userId, id);
    const dayOid = findDayOrThrow(doc, dayId)._id;
    const plain = doc.toObject();
    doc.set(
      'days',
      plain.days.filter((d) => !d._id.equals(dayOid)),
    );
    doc.set(
      'transportCosts',
      plain.transportCosts.filter((t) => !t.dayId.equals(dayOid)),
    );
    await doc.save();
    return toItineraryView(doc);
  }

  // ITN-08: numbers, dates, city groups and budgets are all derived from the
  // order, so they stay consistent without extra work.
  async reorderDays(userId: string, id: string, dto: ReorderDaysDto) {
    const doc = await this.itineraries.findOwnedOrThrow(userId, id);
    const dayOid = findDayOrThrow(doc, dto.dayId)._id;
    if (dto.position > doc.days.length) {
      throw new BadRequestException({
        code: 'INVALID_POSITION',
        message: `Position must be between 1 and ${doc.days.length}`,
      });
    }
    const plain = doc.toObject();
    const from = plain.days.findIndex((d) => d._id.equals(dayOid));
    doc.set('days', moveItem(plain.days, from, dto.position - 1));
    await doc.save();
    return toItineraryView(doc);
  }
}
