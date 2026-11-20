import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { HotelsService } from '../hotels/hotels.service';
import { PublicItinerariesService } from '../itineraries/public-itineraries.service';
import { FavouriteDto } from './dto/favourite.dto';
import { Favourite, FavouriteDocument, FavouriteType } from './schemas/favourite.schema';

const DUPLICATE_KEY = 11000;

@Injectable()
export class FavouritesService {
  constructor(
    @InjectModel(Favourite.name)
    private readonly model: Model<FavouriteDocument>,
    private readonly hotels: HotelsService,
    private readonly publicItineraries: PublicItinerariesService,
  ) {}

  async add(
    user: AuthenticatedUser,
    type: FavouriteType,
    targetId: string,
  ): Promise<FavouriteDto> {
    const objectId = this.objectId(targetId);
    const label = await this.labelFor(type, targetId);

    let doc: FavouriteDocument | null = null;
    try {
      doc = await this.model.create({
        userId: new Types.ObjectId(user.userId),
        type,
        targetId: objectId,
        label,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      doc = await this.model
        .findOne({ userId: new Types.ObjectId(user.userId), type, targetId: objectId })
        .exec();
    }
    return this.toDto(doc!);
  }

  async remove(
    user: AuthenticatedUser,
    type: FavouriteType,
    targetId: string,
  ): Promise<void> {
    const objectId = this.objectId(targetId);
    await this.model
      .deleteOne({
        userId: new Types.ObjectId(user.userId),
        type,
        targetId: objectId,
      })
      .exec();
  }

  async list(user: AuthenticatedUser, type?: FavouriteType): Promise<FavouriteDto[]> {
    const filter: QueryFilter<FavouriteDocument> = {
      userId: new Types.ObjectId(user.userId),
      ...(type ? { type } : {}),
    };
    const docs = await this.model
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .exec();
    return docs.map((doc) => this.toDto(doc));
  }

  private async labelFor(type: FavouriteType, targetId: string): Promise<string> {
    if (type === FavouriteType.HOTEL) {
      try {
        const hotel = await this.hotels.findById(targetId);
        return hotel.name;
      } catch {
        throw new NotFoundException({
          code: 'HOTEL_NOT_FOUND',
          message: 'Hotel not found',
        });
      }
    }
    const itinerary = await this.publicItineraries.assertPublic(targetId);
    return itinerary.title;
  }

  private objectId(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException({
        code: 'INVALID_ID',
        message: 'targetId must be a MongoDB id',
      });
    }
    return new Types.ObjectId(value);
  }

  private toDto(doc: FavouriteDocument): FavouriteDto {
    return {
      id: String(doc._id),
      type: doc.type,
      targetId: String(doc.targetId),
      label: doc.label,
      createdAt: doc.createdAt?.toISOString(),
    };
  }
}
