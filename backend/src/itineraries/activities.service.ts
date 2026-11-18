import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { toDecimal128 } from '../common/money/money';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { ItinerariesService } from './itineraries.service';
import {
  findDayOrThrow,
  findOwnedByChildOrThrow,
  NotFoundError,
} from './itinerary-lookup';
import { toActivityView } from './itinerary.view';
import { Activity, Itinerary } from './schemas/itinerary.schema';

export const ACTIVITY_NOT_FOUND: NotFoundError = {
  code: 'ACTIVITY_NOT_FOUND',
  message: 'Activity not found',
};

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
  ) {}

  private findOwnedByActivity(user: AuthenticatedUser, activityId: string) {
    return findOwnedByChildOrThrow(
      this.itineraryModel,
      user,
      'days.activities._id',
      activityId,
      ACTIVITY_NOT_FOUND,
    );
  }

  // ITN-10
  async create(
    user: AuthenticatedUser,
    itineraryId: string,
    dayId: string,
    dto: CreateActivityDto,
  ) {
    const doc = await this.itineraries.findOwnedOrThrow(user, itineraryId);
    const day = findDayOrThrow(doc, dayId);
    if (dto.currency !== undefined) {
      await this.referenceData.assertSupportedCurrency(dto.currency);
    }
    day.activities.push({
      name: dto.name,
      description: dto.description,
      time: dto.time,
      cost:
        dto.cost === undefined ? undefined : toDecimal128(dto.cost.toFixed(2)),
      currency: dto.currency,
    } as Activity);
    await doc.save();
    return toActivityView(day.activities[day.activities.length - 1]);
  }

  async update(
    user: AuthenticatedUser,
    activityId: string,
    dto: UpdateActivityDto,
  ) {
    const doc = await this.findOwnedByActivity(user, activityId);
    const oid = new Types.ObjectId(activityId);
    const activity = doc.days
      .flatMap((d) => d.activities)
      .find((a) => a._id.equals(oid))!;
    if (dto.currency !== undefined) {
      await this.referenceData.assertSupportedCurrency(dto.currency);
    }
    // A cost always needs a currency, also when only the cost is edited.
    if (dto.cost !== undefined && !(dto.currency ?? activity.currency)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        errors: [
          { field: 'currency', messages: ['currency is required with cost'] },
        ],
      });
    }
    if (dto.name !== undefined) activity.name = dto.name;
    if (dto.description !== undefined) activity.description = dto.description;
    if (dto.time !== undefined) activity.time = dto.time;
    if (dto.cost !== undefined)
      activity.cost = toDecimal128(dto.cost.toFixed(2));
    if (dto.currency !== undefined) activity.currency = dto.currency;
    await doc.save();
    return toActivityView(activity);
  }

  async remove(user: AuthenticatedUser, activityId: string): Promise<void> {
    const doc = await this.findOwnedByActivity(user, activityId);
    const oid = new Types.ObjectId(activityId);
    for (const day of doc.days) {
      day.activities = day.activities.filter((a) => !a._id.equals(oid));
    }
    await doc.save();
  }
}
