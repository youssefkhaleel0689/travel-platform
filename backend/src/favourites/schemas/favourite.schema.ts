import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type FavouriteDocument = HydratedDocument<Favourite>;

export enum FavouriteType {
  HOTEL = 'HOTEL',
  ITINERARY = 'ITINERARY',
}

/** BON-02: a saved hotel or public itinerary. The label is a snapshot. */
@Schema({ collection: 'favourites', timestamps: true })
export class Favourite {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(FavouriteType), required: true })
  type: FavouriteType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  targetId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  label: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const FavouriteSchema = SchemaFactory.createForClass(Favourite);

FavouriteSchema.index({ userId: 1, type: 1, targetId: 1 }, { unique: true });
FavouriteSchema.index({ userId: 1, createdAt: -1 });
