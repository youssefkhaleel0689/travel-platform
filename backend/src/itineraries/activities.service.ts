import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { MediaTargetType } from '../media/media.constants';
import { ImageFile, MediaService, UploadedImage } from '../media/media.service';
import { removeActivityImages } from './activity-images.cleanup';
import { toDecimal128 } from '../common/money/money';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { ItinerariesService } from './itineraries.service';
import {
  findDayOrThrow,
  findOwnedByChildOrThrow,
  NotFoundError,
} from './itinerary-lookup';
import { toActivityImageView, toActivityView } from './itinerary.view';
import {
  Activity,
  Itinerary,
  NOT_DELETED,
  PUBLICLY_VISIBLE,
  Visibility,
} from './schemas/itinerary.schema';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

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
    private readonly media: MediaService,
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
    await removeActivityImages(this.media, [activityId]);
  }

  // ---------- images (ITN-12, under the shared upload rule GEN-08) ----------

  /**
   * Stores the file through the shared media store, which checks the type (on
   * the bytes), the 5 MB size and the 5-image limit, then lists it on the
   * activity. If the activity was deleted in between, the file is removed again.
   */
  async addImage(
    user: AuthenticatedUser,
    activityId: string,
    file: UploadedImage | undefined,
  ) {
    const doc = await this.findOwnedByActivity(user, activityId);
    const stored = await this.media.storeImage({
      ownerId: user.userId,
      targetType: MediaTargetType.ACTIVITY,
      targetId: activityId,
      file,
      urlFor: (imageId) => `/api/activities/${activityId}/images/${imageId}`,
    });
    const image = {
      _id: new Types.ObjectId(stored.id),
      url: stored.url,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      uploadedAt: stored.uploadedAt,
    };
    const aid = new Types.ObjectId(activityId);
    const result = await this.itineraryModel
      .updateOne(
        { _id: doc._id, 'days.activities._id': aid },
        { $push: { 'days.$[].activities.$[a].images': image } },
        { arrayFilters: [{ 'a._id': aid }] },
      )
      .exec();
    if (result.matchedCount === 0) {
      await this.media.removeFromTarget(
        MediaTargetType.ACTIVITY,
        activityId,
        stored.id,
      );
      throw new NotFoundException(ACTIVITY_NOT_FOUND);
    }
    return toActivityImageView(image);
  }

  async removeImage(
    user: AuthenticatedUser,
    activityId: string,
    imageId: string,
  ): Promise<void> {
    const doc = await this.findOwnedByActivity(user, activityId);
    // 404 IMAGE_NOT_FOUND when this activity has no such image.
    await this.media.removeFromTarget(
      MediaTargetType.ACTIVITY,
      activityId,
      imageId,
    );
    const aid = new Types.ObjectId(activityId);
    await this.itineraryModel
      .updateOne(
        { _id: doc._id },
        {
          $pull: {
            'days.$[].activities.$[a].images': {
              _id: new Types.ObjectId(imageId),
            },
          },
        },
        { arrayFilters: [{ 'a._id': aid }] },
      )
      .exec();
  }

  /**
   * The image file, for whoever may see the itinerary: its owner, or anyone
   * when it is public and not hidden by moderation. Anything else is the same
   * 404, so a private itinerary's images cannot be probed.
   */
  async openImage(
    viewer: AuthenticatedUser | undefined,
    activityId: string,
    imageId: string,
  ): Promise<ImageFile> {
    if (!OBJECT_ID.test(activityId)) {
      throw new NotFoundException(ACTIVITY_NOT_FOUND);
    }
    const mayView: Record<string, unknown>[] = [
      { visibility: Visibility.PUBLIC, ...PUBLICLY_VISIBLE },
    ];
    if (viewer && OBJECT_ID.test(viewer.userId)) {
      mayView.push({
        userId: new Types.ObjectId(viewer.userId),
        ...NOT_DELETED,
      });
    }
    const visible = await this.itineraryModel
      .exists({
        'days.activities._id': new Types.ObjectId(activityId),
        $or: mayView,
      })
      .exec();
    if (!visible) {
      throw new NotFoundException(ACTIVITY_NOT_FOUND);
    }
    return this.media.openForTarget(
      MediaTargetType.ACTIVITY,
      activityId,
      imageId,
    );
  }
}
