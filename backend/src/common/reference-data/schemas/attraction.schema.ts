import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SLUG_ID } from '../reference-data.patterns';

export type AttractionDocument = HydratedDocument<Attraction>;

@Schema({ collection: 'attractions', versionKey: false, timestamps: false })
export class Attraction {
  // A readable id, e.g. att-1.
  @Prop({ type: String, required: true, match: SLUG_ID })
  _id: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, trim: true, match: SLUG_ID })
  cityId: string;
}

export const AttractionSchema = SchemaFactory.createForClass(Attraction);

AttractionSchema.index({ cityId: 1 });
