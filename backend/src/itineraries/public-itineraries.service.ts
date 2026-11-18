import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { PageDto } from '../common/pagination/dto/page.dto';
import { paginateQuery } from '../common/pagination/paginate';
import { PublicSearchQueryDto } from './dto/public-search-query.dto';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBudgetSummaryService } from './itinerary-budget-summary.service';
import { buildCloneData } from './itinerary-clone.logic';
import { toItineraryView } from './itinerary.view';
import { toPublicSummary } from './public-itinerary.view';
import { CITIES, COUNTRIES } from './reference/reference-data';
import {
  Itinerary,
  ItineraryDocument,
  Visibility,
} from './schemas/itinerary.schema';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class PublicItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
    private readonly itineraries: ItinerariesService,
    private readonly summaries: ItineraryBudgetSummaryService,
  ) {}

  // ITN-21: search public itineraries (the user does not need to be logged in)
  async search(query: PublicSearchQueryDto) {
    const { q, country, city, minDays, maxDays, page } = query;
    if (minDays !== undefined && maxDays !== undefined && minDays > maxDays) {
      throw new BadRequestException({
        code: 'INVALID_VALUE',
        message: 'minDays cannot be greater than maxDays',
      });
    }

    const and: Record<string, unknown>[] = [{ visibility: Visibility.PUBLIC }];
    if (q) {
      const kw = q.toLowerCase();
      const countryCodes = COUNTRIES.filter(
        (c) => c.code.toLowerCase() === kw || c.name.toLowerCase().includes(kw),
      ).map((c) => c.code);
      const cityIds = CITIES.filter(
        (c) => c.id === kw || c.name.toLowerCase().includes(kw),
      ).map((c) => c.id);
      and.push({
        $or: [
          { title: { $regex: escapeRegex(q), $options: 'i' } },
          { countries: { $in: countryCodes } },
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

  private async findPublicOrThrow(id: string): Promise<ItineraryDocument> {
    const doc = await this.itineraryModel.findOne({
      _id: this.itineraries.toObjectId(id, 'itinerary id'),
      visibility: Visibility.PUBLIC,
    });
    if (!doc) {
      throw new NotFoundException('Public itinerary not found');
    }
    return doc;
  }

  async findOne(id: string, currency?: string) {
    const doc = await this.findPublicOrThrow(id);
    const view = toItineraryView(doc);
    if (!currency) return view;
    return {
      ...view,
      budgetSummary: await this.summaries.summarize(doc, currency),
    };
  }

  // ITN-21: independent private copy that keeps attribution
  async clone(userId: string, id: string) {
    const owner = this.itineraries.userObjectId(userId);
    const source = await this.findPublicOrThrow(id);
    const copy = await this.itineraryModel.create(
      buildCloneData(source.toObject(), owner),
    );
    return toItineraryView(copy);
  }
}
