import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ownerFilter } from '../common/auth/ownership';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { PageDto } from '../common/pagination/dto/page.dto';
import { paginateQuery } from '../common/pagination/paginate';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import { MediaService } from '../media/media.service';
import { removeActivityImages } from './activity-images.cleanup';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import {
  Itinerary,
  ItineraryDocument,
  NOT_DELETED,
} from './schemas/itinerary.schema';
import { toItinerarySummary, toItineraryView } from './itinerary.view';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export const ITINERARY_NOT_FOUND = {
  code: 'ITINERARY_NOT_FOUND',
  message: 'Itinerary not found',
} as const;

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
    private readonly referenceData: ReferenceDataService,
    private readonly media: MediaService,
  ) {}

  /** True for a 24-hex id; anything else can never match a document. */
  isObjectId(id: string): boolean {
    return OBJECT_ID.test(id);
  }

  userObjectId(user: AuthenticatedUser): Types.ObjectId {
    if (!this.isObjectId(user.userId)) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
    }
    return new Types.ObjectId(user.userId);
  }

  /**
   * Ownership check (ACC-11), always in the database filter. A malformed id, a
   * missing itinerary and someone else's itinerary all give the same 404, so ids
   * cannot be probed. Returns a hydrated document because the callers edit and
   * save its embedded days.
   */
  async findOwnedOrThrow(
    user: AuthenticatedUser,
    itineraryId: string,
  ): Promise<ItineraryDocument> {
    if (!this.isObjectId(itineraryId)) {
      throw new NotFoundException(ITINERARY_NOT_FOUND);
    }
    const doc = await this.itineraryModel
      .findOne({ _id: itineraryId, ...ownerFilter(user), ...NOT_DELETED })
      .exec();
    if (!doc) {
      throw new NotFoundException(ITINERARY_NOT_FOUND);
    }
    return doc;
  }

  // ITN-01
  async create(user: AuthenticatedUser, dto: CreateItineraryDto) {
    await this.referenceData.assertCountriesExist(dto.countries);
    const doc = await this.itineraryModel.create({
      userId: this.userObjectId(user),
      title: dto.title,
      countries: dto.countries,
      startDate: new Date(dto.startDate),
    });
    return toItineraryView(doc);
  }

  // ITN-03: most recently updated first; uses the team pagination helper (GEN-05)
  async list(user: AuthenticatedUser, page: number) {
    const result = await paginateQuery(
      this.itineraryModel,
      { ...ownerFilter(user), ...NOT_DELETED },
      { page, sort: { updatedAt: -1 } },
    );
    return new PageDto(result.items.map(toItinerarySummary), result.meta);
  }

  // ITN-03
  async findOne(user: AuthenticatedUser, id: string) {
    return toItineraryView(await this.findOwnedOrThrow(user, id));
  }

  // ITN-01 (edit), ITN-20 (visibility can be changed here too)
  async update(user: AuthenticatedUser, id: string, dto: UpdateItineraryDto) {
    const doc = await this.findOwnedOrThrow(user, id);
    if (dto.countries !== undefined) {
      await this.referenceData.assertCountriesExist(dto.countries);
    }
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.countries !== undefined) doc.countries = dto.countries;
    if (dto.startDate !== undefined) doc.startDate = new Date(dto.startDate);
    if (dto.visibility !== undefined) doc.visibility = dto.visibility;
    await doc.save();
    return toItineraryView(doc);
  }

  // ITN-01 (delete). Clones made by others are separate documents,
  // so they stay untouched.
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const doc = await this.findOwnedOrThrow(user, id);
    const activityIds = doc.days.flatMap((d) =>
      d.activities.map((a) => a._id.toString()),
    );
    await doc.deleteOne();
    // ITN-12: the activities' stored images go too. A clone has its own
    // activities (and starts without images), so it is not affected.
    await removeActivityImages(this.media, activityIds);
  }

  // ITN-20
  async setVisibility(
    user: AuthenticatedUser,
    id: string,
    dto: SetVisibilityDto,
  ) {
    const doc = await this.findOwnedOrThrow(user, id);
    doc.visibility = dto.visibility;
    await doc.save();
    return toItineraryView(doc);
  }
}
