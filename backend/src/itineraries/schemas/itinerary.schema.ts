import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export enum Visibility {
  PRIVATE = 'private',
  PUBLIC = 'public',
}

export enum BudgetCategory {
  FOOD = 'food',
  ACCOMMODATION = 'accommodation',
  LOCAL_TRANSPORT = 'local_transport',
  ACTIVITIES = 'activities',
}

export enum TransportMode {
  FLIGHT = 'flight',
  TRAIN = 'train',
  BUS = 'bus',
  CAR = 'car',
  FERRY = 'ferry',
  OTHER = 'other',
}

@Schema({ _id: true })
export class Activity {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ trim: true, maxlength: 1000 })
  description?: string;

  // Optional "HH:mm"
  @Prop()
  time?: string;

  // Money: Decimal128 in the database, a string in the API (PAY-04 convention).
  @Prop({ type: SchemaTypes.Decimal128 })
  cost?: Types.Decimal128;

  @Prop({ uppercase: true, length: 3 })
  currency?: string;
}
export const ActivitySchema = SchemaFactory.createForClass(Activity);

@Schema({ _id: true })
export class BudgetEntry {
  _id: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(BudgetCategory) })
  category: BudgetCategory;

  @Prop({ type: SchemaTypes.Decimal128, required: true })
  amount: Types.Decimal128;

  @Prop({ required: true, uppercase: true, length: 3 })
  currency: string;
}
export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);

// A day has no stored number or date: both are derived from its position
// in `days` and the itinerary startDate, so reorder/delete can never leave
// them inconsistent.
@Schema({ _id: true })
export class ItineraryDay {
  _id: Types.ObjectId;

  @Prop({ required: true })
  city: string; // city id from the reference data, e.g. "cairo"

  @Prop({ trim: true, maxlength: 2000 })
  notes?: string;

  @Prop({ type: [ActivitySchema], default: [] })
  activities: Activity[];

  @Prop({ type: [BudgetEntrySchema], default: [] })
  budgetEntries: BudgetEntry[];
}
export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);

@Schema({ _id: true })
export class TransportCost {
  _id: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(TransportMode) })
  mode: TransportMode;

  @Prop({ required: true })
  fromCity: string;

  @Prop({ required: true })
  toCity: string;

  @Prop({ type: SchemaTypes.Decimal128, required: true })
  amount: Types.Decimal128;

  @Prop({ required: true, uppercase: true, length: 3 })
  currency: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  dayId: Types.ObjectId;
}
export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);

@Schema({ _id: false })
export class ClonedFrom {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Itinerary', required: true })
  itineraryId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;
}
export const ClonedFromSchema = SchemaFactory.createForClass(ClonedFrom);

@Schema({ timestamps: true, collection: 'itineraries' })
export class Itinerary {
  _id: Types.ObjectId;

  // The owner (ACC-11): named userId like every other owner reference.
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  title: string;

  @Prop({ type: [String], required: true })
  countries: string[];

  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({
    type: String,
    enum: Object.values(Visibility),
    default: Visibility.PRIVATE,
    index: true,
  })
  visibility: Visibility;

  @Prop({ type: [ItineraryDaySchema], default: [] })
  days: ItineraryDay[];

  @Prop({ type: [TransportCostSchema], default: [] })
  transportCosts: TransportCost[];

  @Prop({ type: ClonedFromSchema })
  clonedFrom?: ClonedFrom;

  createdAt: Date;
  updatedAt: Date;
}

export type ItineraryDocument = HydratedDocument<Itinerary>;
export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);
ItinerarySchema.index({ userId: 1, updatedAt: -1 });
