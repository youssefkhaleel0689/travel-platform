import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { ItinerariesService } from './itineraries.service';
import { findDayOrThrow, findOwnedByChildOrThrow } from './itinerary-lookup';
import { toActivityView } from './itinerary.view';
import { Activity, Itinerary } from './schemas/itinerary.schema';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly itineraries: ItinerariesService,
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
  ) {}

  private findOwnedByActivity(userId: string, activityId: string) {
    return findOwnedByChildOrThrow(
      this.itineraryModel,
      userId,
      'days.activities._id',
      activityId,
      'Activity not found',
    );
  }

  // ITN-10
  async create(
    userId: string,
    itineraryId: string,
    dayId: string,
    dto: CreateActivityDto,
  ) {
    const doc = await this.itineraries.findOwnedOrThrow(userId, itineraryId);
    const day = findDayOrThrow(doc, dayId);
    day.activities.push({
      name: dto.name,
      description: dto.description,
      time: dto.time,
      cost: dto.cost,
      currency: dto.currency,
    } as Activity);
    await doc.save();
    return toActivityView(day.activities[day.activities.length - 1]);
  }

  async update(userId: string, activityId: string, dto: UpdateActivityDto) {
    const doc = await this.findOwnedByActivity(userId, activityId);
    const oid = new Types.ObjectId(activityId);
    const activity = doc.days
      .flatMap((d) => d.activities)
      .find((a) => a._id.equals(oid))!;
    if (dto.name !== undefined) activity.name = dto.name;
    if (dto.description !== undefined) activity.description = dto.description;
    if (dto.time !== undefined) activity.time = dto.time;
    if (dto.cost !== undefined) activity.cost = dto.cost;
    if (dto.currency !== undefined) activity.currency = dto.currency;
    await doc.save();
    return toActivityView(activity);
  }

  async remove(userId: string, activityId: string): Promise<void> {
    const doc = await this.findOwnedByActivity(userId, activityId);
    const oid = new Types.ObjectId(activityId);
    for (const day of doc.days) {
      day.activities = day.activities.filter((a) => !a._id.equals(oid));
    }
    await doc.save();
  }
}
