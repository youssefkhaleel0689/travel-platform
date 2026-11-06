import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { COUNTRY_CODE, SLUG_ID } from '../reference-data.patterns';

export type CityDocument = HydratedDocument<City>;

@Schema({ collection: 'cities', versionKey: false, timestamps: false })
export class City {
  // A readable id, e.g. new_york.
  @Prop({ type: String, required: true, match: SLUG_ID })
  _id: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, trim: true, match: COUNTRY_CODE })
  countryId: string;
}

export const CitySchema = SchemaFactory.createForClass(City);

CitySchema.index({ countryId: 1 });
