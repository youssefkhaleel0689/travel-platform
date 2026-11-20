import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { COUNTRY_CODE, IATA_CODE, SLUG_ID } from '../reference-data.patterns';

export type AirportDocument = HydratedDocument<Airport>;

@Schema({ collection: 'airports', versionKey: false, timestamps: false })
export class Airport {
  // The IATA code, e.g. CAI.
  @Prop({ type: String, required: true, match: IATA_CODE })
  _id: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, trim: true, match: SLUG_ID })
  cityId: string;

  @Prop({ type: String, required: true, trim: true, match: COUNTRY_CODE })
  countryId: string;

  // IANA zone, e.g. Africa/Cairo. The seed script checks that it is real.
  @Prop({ type: String, required: true, trim: true })
  timeZone: string;
}

export const AirportSchema = SchemaFactory.createForClass(Airport);

AirportSchema.index({ cityId: 1 });
