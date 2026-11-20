import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { COUNTRY_CODE, CURRENCY_CODE } from '../reference-data.patterns';

export type CountryDocument = HydratedDocument<Country>;

@Schema({ collection: 'countries', versionKey: false, timestamps: false })
export class Country {
  // The country code, e.g. EG.
  @Prop({ type: String, required: true, match: COUNTRY_CODE })
  _id: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, trim: true, match: CURRENCY_CODE })
  currency: string;
}

export const CountrySchema = SchemaFactory.createForClass(Country);
