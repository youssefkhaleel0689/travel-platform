import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import { MediaService } from '../media/media.service';
import { removeActivityImages } from './activity-images.cleanup';
import { CreateDayDto, ReorderDaysDto, UpdateDayDto } from './dto/day.dto';
import { ItinerariesService } from './itineraries.service';
import { MAX_DAYS, moveItem } from './itinerary-days.logic';
import { findDayOrThrow } from './itinerary-lookup';
import { toItineraryView } from './itinerary.view';
import { ItineraryDay } from './schemas/itinerary.schema';

@Injectable()
export class DaysService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
    private readonly media: MediaService,
  ) {}

  // ITN-05: a new day goes at the end; its number and date follow from that.
  async addDay(user: AuthenticatedUser, id: string, dto: CreateDayDto) {
    const doc = await this.itineraries.findOwnedOrThrow(user, id);
    await this.referenceData.assertCityExists(dto.city);
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
    user: AuthenticatedUser,
    id: string,
    dayId: string,
    dto: UpdateDayDto,
  ) {
    const doc = await this.itineraries.findOwnedOrThrow(user, id);
    const day = findDayOrThrow(doc, dayId);
    if (dto.city !== undefined) {
      await this.referenceData.assertCityExists(dto.city);
      day.city = dto.city;
    }
    if (dto.notes !== undefined) day.notes = dto.notes;
    await doc.save();
    return toItineraryView(doc);
  }

  // ITN-07: later days move up one number and one date automatically, and the
  // day's activities (with their images, ITN-12), budget entries, transport costs
  // and booking links (ITN-27) go with it.
  async deleteDay(user: AuthenticatedUser, id: string, dayId: string) {
    const doc = await this.itineraries.findOwnedOrThrow(user, id);
    const day = findDayOrThrow(doc, dayId);
    const dayOid = day._id;
    const activityIds = day.activities.map((a) => a._id.toString());
    const plain = doc.toObject();
    doc.set(
      'days',
      plain.days.filter((d) => !d._id.equals(dayOid)),
    );
    doc.set(
      'transportCosts',
      plain.transportCosts.filter((t) => !t.dayId.equals(dayOid)),
    );
    doc.set(
      'bookingLinks',
      (plain.bookingLinks ?? []).filter((l) => !l.dayId.equals(dayOid)),
    );
    await doc.save();
    await removeActivityImages(this.media, activityIds);
    return toItineraryView(doc);
  }

  // ITN-08: numbers, dates, city groups and budgets are all derived from the
  // order, so they stay consistent without extra work.
  async reorderDays(user: AuthenticatedUser, id: string, dto: ReorderDaysDto) {
    const doc = await this.itineraries.findOwnedOrThrow(user, id);
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
