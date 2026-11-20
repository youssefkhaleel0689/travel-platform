import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import {
  applyModeration,
  type ModeratedContent,
  type ModerationResult,
} from '../common/moderation/content-moderation.port';
import { ModerationState } from '../common/moderation/moderation-state';
import { PageDto } from '../common/pagination/dto/page.dto';
import { paginateQuery } from '../common/pagination/paginate';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import { PublicSearchQueryDto } from './dto/public-search-query.dto';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBudgetSummaryService } from './itinerary-budget-summary.service';
import { buildCloneData } from './itinerary-clone.logic';
import { toItineraryView } from './itinerary.view';
import { toPublicSummary } from './public-itinerary.view';
import {
  Itinerary,
  ItineraryDocument,
  PUBLICLY_VISIBLE,
  Visibility,
} from './schemas/itinerary.schema';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const PUBLIC_ITINERARY_NOT_FOUND = {
  code: 'ITINERARY_NOT_FOUND',
  message: 'Public itinerary not found',
} as const;

@Injectable()
export class PublicItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
    private readonly itineraries: ItinerariesService,
    private readonly summaries: ItineraryBudgetSummaryService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  // ITN-21: search public itineraries (the user does not need to be logged in)
  async search(query: PublicSearchQueryDto) {
    const { q, country, city, minDays, maxDays, page } = query;
    if (minDays !== undefined && maxDays !== undefined && minDays > maxDays) {
      throw new BadRequestException({
        code: 'INVALID_DAY_RANGE',
        message: 'minDays cannot be greater than maxDays',
      });
    }
    if (country !== undefined) {
      await this.referenceData.assertCountriesExist([country]);
    }
    if (city !== undefined) {
      await this.referenceData.assertCityExists(city);
    }

    const and: Record<string, unknown>[] = [
      { visibility: Visibility.PUBLIC },
      PUBLICLY_VISIBLE,
    ];
    if (q) {
      // A keyword matches the title, or a country or city by id or name.
      const { countryIds, cityIds } =
        await this.referenceData.findPlaceIdsByKeyword(q);
      and.push({
        $or: [
          { title: { $regex: escapeRegex(q), $options: 'i' } },
          { countries: { $in: countryIds } },
          { 'days.city': { $in: cityIds } },
        ],
      });
    }
    if (country) and.push({ countries: country });
    if (city) and.push({ 'days.city': city });
    if (minDays !== undefined) {
      and.push({ $expr: { $gte: [{ $size: '$days' }, minDays] } });
    }
    if (maxDays !== undefined) {
      and.push({ $expr: { $lte: [{ $size: '$days' }, maxDays] } });
    }

    const result = await paginateQuery(
      this.itineraryModel,
      { $and: and } as QueryFilter<Itinerary>,
      { page, sort: { updatedAt: -1 } },
    );
    return new PageDto(result.items.map(toPublicSummary), result.meta);
  }

  // BLG-12: the public itineraries shown on an author's blog page.
  async listByAuthor(authorId: string, page: number) {
    const result = await paginateQuery(
      this.itineraryModel,
      {
        userId: new Types.ObjectId(authorId),
        visibility: Visibility.PUBLIC,
        ...PUBLICLY_VISIBLE,
      } as QueryFilter<Itinerary>,
      { page, sort: { updatedAt: -1 } },
    );
    return new PageDto(result.items.map(toPublicSummary), result.meta);
  }

  /**
   * BLG-13: whether a blog post may still show this itinerary. It was public
   * when it was attached, but the owner can make it private or delete it and
   * an admin can hide it later; after that its id is no longer shown.
   */
  async isPubliclyVisible(id: string): Promise<boolean> {
    if (!this.itineraries.isObjectId(id)) return false;
    const found = await this.itineraryModel
      .exists({ _id: id, visibility: Visibility.PUBLIC, ...PUBLICLY_VISIBLE })
      .exec();
    return found !== null;
  }

  // A malformed id, a missing itinerary and a private one all give the same 404.
  private async findPublicOrThrow(id: string): Promise<ItineraryDocument> {
    if (!this.itineraries.isObjectId(id)) {
      throw new NotFoundException(PUBLIC_ITINERARY_NOT_FOUND);
    }
    const doc = await this.itineraryModel
      .findOne({ _id: id, visibility: Visibility.PUBLIC, ...PUBLICLY_VISIBLE })
      .exec();
    if (!doc) {
      throw new NotFoundException(PUBLIC_ITINERARY_NOT_FOUND);
    }
    return doc;
  }

  async findOne(id: string, currency?: string) {
    const doc = await this.findPublicOrThrow(id);
    const full = toItineraryView(doc);
    // ITN-27: linked bookings (their ids and references) are the owner's
    // private data; a public view shows the days without them.
    const view = {
      ...full,
      days: full.days.map(({ bookingLinks: _private, ...day }) => day),
    };
    if (!currency) return view;
    await this.referenceData.assertSupportedCurrency(currency);
    return {
      ...view,
      budgetSummary: await this.summaries.summarize(doc, currency),
    };
  }

  // ITN-21: independent private copy that keeps attribution
  async clone(user: AuthenticatedUser, id: string) {
    const newOwner = this.itineraries.userObjectId(user);
    const source = await this.findPublicOrThrow(id);
    const copy = await this.itineraryModel.create(
      buildCloneData(source.toObject(), newOwner),
    );
    return toItineraryView(copy);
  }

  /** BON-02: any registered user may save a PUBLIC itinerary as a favourite. */
  async assertPublic(id: string) {
    const itinerary = await this.findPublicOrThrow(id);
    return { id: String(itinerary._id), title: itinerary.title };
  }

  /**
   * BLG-13: an author may attach only their own PUBLIC itinerary to a post.
   * The same 404 is used for a missing, private or hidden itinerary.
   */
  async assertAttachableFor(userId: string, id: string) {
    const itinerary = await this.findPublicOrThrow(id);
    if (String(itinerary.userId) !== userId) {
      throw new ForbiddenException({
        code: 'NOT_ITINERARY_OWNER',
        message: 'You can attach only your own itinerary',
      });
    }
    return { id: String(itinerary._id), title: itinerary.title };
  }

  // GEN-09/GEN-10 (D2): what admin moderation needs to know about an itinerary.
  async findForModeration(id: string): Promise<ModeratedContent | null> {
    if (!this.itineraries.isObjectId(id)) return null;
    const doc = await this.itineraryModel
      .findById(id)
      .select('userId title visibility moderationState')
      .lean()
      .exec();
    if (!doc) return null;
    const state = doc.moderationState ?? ModerationState.VISIBLE;
    return {
      id,
      ownerId: String(doc.userId),
      moderationState: state,
      reportable:
        doc.visibility === Visibility.PUBLIC &&
        state === ModerationState.VISIBLE,
      preview: doc.title,
    };
  }

  // GEN-10 (D2): hide, restore or delete on an admin's decision. Older
  // itineraries have no moderationState yet, so it is filled in first.
  async moderate(
    id: string,
    to: ModerationState,
    actorId: string,
  ): Promise<ModerationResult | null> {
    if (!this.itineraries.isObjectId(id)) return null;
    await this.itineraryModel
      .updateOne(
        { _id: id, moderationState: { $exists: false } },
        { $set: { moderationState: ModerationState.VISIBLE } },
      )
      .exec();
    return applyModeration(this.itineraryModel, id, to, actorId);
  }
}
