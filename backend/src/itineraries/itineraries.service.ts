import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PageDto } from '../common/pagination/dto/page.dto';
import { paginateQuery } from '../common/pagination/paginate';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import { Itinerary, ItineraryDocument } from './schemas/itinerary.schema';
import { toItinerarySummary, toItineraryView } from './itinerary.view';

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
  ) {}

  toObjectId(id: string, what: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        code: 'INVALID_VALUE',
        message: `Invalid ${what}`,
      });
    }
    return new Types.ObjectId(id);
  }

  userObjectId(userId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(userId)) {
      throw new UnauthorizedException('Not authenticated');
    }
    return new Types.ObjectId(userId);
  }

  // Ownership check (backend-side, never only in the frontend).
  // Someone else's itinerary is reported as 404 so its existence is not leaked.
  async findOwnedOrThrow(
    userId: string,
    itineraryId: string,
  ): Promise<ItineraryDocument> {
    const doc = await this.itineraryModel.findOne({
      _id: this.toObjectId(itineraryId, 'itinerary id'),
      owner: this.userObjectId(userId),
    });
    if (!doc) {
      throw new NotFoundException('Itinerary not found');
    }
    return doc;
  }

  // ITN-01
  async create(userId: string, dto: CreateItineraryDto) {
    const doc = await this.itineraryModel.create({
      owner: this.userObjectId(userId),
      title: dto.title,
      countries: dto.countries,
      startDate: new Date(dto.startDate),
    });
    return toItineraryView(doc);
  }

  // ITN-03: most recently updated first; uses the team pagination helper (GEN-05)
  async list(userId: string, page: number) {
    const result = await paginateQuery(
      this.itineraryModel,
      { owner: this.userObjectId(userId) },
      { page, sort: { updatedAt: -1 } },
    );
    return new PageDto(result.items.map(toItinerarySummary), result.meta);
  }

  // ITN-03
  async findOne(userId: string, id: string) {
    return toItineraryView(await this.findOwnedOrThrow(userId, id));
  }

  // ITN-01 (edit)
  async update(userId: string, id: string, dto: UpdateItineraryDto) {
    const doc = await this.findOwnedOrThrow(userId, id);
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.countries !== undefined) doc.countries = dto.countries;
    if (dto.startDate !== undefined) doc.startDate = new Date(dto.startDate);
    await doc.save();
    return toItineraryView(doc);
  }

  // ITN-01 (delete). Clones made by others are separate documents,
  // so they stay untouched.
  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.findOwnedOrThrow(userId, id);
    await doc.deleteOne();
  }

  // ITN-20
  async setVisibility(userId: string, id: string, dto: SetVisibilityDto) {
    const doc = await this.findOwnedOrThrow(userId, id);
    doc.visibility = dto.visibility;
    await doc.save();
    return toItineraryView(doc);
  }
}
