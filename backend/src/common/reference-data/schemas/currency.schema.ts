import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { CURRENCY_CODE } from '../reference-data.patterns';

export type CurrencyDocument = HydratedDocument<Currency>;

@Schema({ collection: 'currencies', versionKey: false, timestamps: false })
export class Currency {
  // The currency code, e.g. USD.
  @Prop({ type: String, required: true, match: CURRENCY_CODE })
  _id: string;
}

export const CurrencySchema = SchemaFactory.createForClass(Currency);
