import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// One document: the latest rates we fetched from FXRatesAPI (base USD).
// It is the cache (one fetch per day) and the fallback if the API is down.
@Schema({ collection: 'exchange_rates' })
export class ExchangeRateSnapshot {
  @Prop({ required: true, unique: true })
  base: string;

  @Prop({ type: Object, required: true })
  rates: Record<string, number>;

  // Date reported by the API for these rates
  @Prop({ type: Date, required: true })
  rateDate: Date;

  // When we last fetched them
  @Prop({ type: Date, required: true })
  fetchedAt: Date;
}

export type ExchangeRateSnapshotDocument =
  HydratedDocument<ExchangeRateSnapshot>;
export const ExchangeRateSnapshotSchema =
  SchemaFactory.createForClass(ExchangeRateSnapshot);
