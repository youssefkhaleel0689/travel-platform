import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
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

    const and: Record<string, unknown>[] = [{ visibility: Visibility.PUBLIC }];
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

  // A malformed id, a missing itinerary and a private one all give the same 404.
  private async findPublicOrThrow(id: string): Promise<ItineraryDocument> {
    if (!this.itineraries.isObjectId(id)) {
      throw new NotFoundException(PUBLIC_ITINERARY_NOT_FOUND);
    }
    const doc = await this.itineraryModel
      .findOne({ _id: id, visibility: Visibility.PUBLIC })
      .exec();
    if (!doc) {
      throw new NotFoundException(PUBLIC_ITINERARY_NOT_FOUND);
    }
    return doc;
  }

  async findOne(id: string, currency?: string) {
    const doc = await this.findPublicOrThrow(id);
    const view = toItineraryView(doc);
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
}
