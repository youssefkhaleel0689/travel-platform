import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

// Airline designators (FLT-01): IATA is 2 letters or digits (MS, 9W), ICAO is 3 letters (MSR).
export const AIRLINE_IATA_CODE = /^[A-Z0-9]{2}$/;
export const AIRLINE_ICAO_CODE = /^[A-Z]{3}$/;

export enum AirlineStatus {
  ACTIVE = 'ACTIVE',
  DEACTIVATED = 'DEACTIVATED',
}

// Collection name is pinned so Mongoose never pluralises it (schema section 1).
@Schema({ collection: 'airlines', versionKey: false, timestamps: true })
export class Airline {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    match: AIRLINE_IATA_CODE,
  })
  iataCode: string;

  @Prop({ type: String, trim: true, uppercase: true, match: AIRLINE_ICAO_CODE })
  icaoCode?: string;

  // URL of the one logo (GEN-08). Set by the upload endpoint, added in a later PR.
  @Prop({ type: String, default: null })
  logo: string | null;

  // Changed only by the admin deactivate / reactivate endpoints (ACC-15), never by FLT-01.
  @Prop({
    type: String,
    enum: Object.values(AirlineStatus),
    required: true,
    default: AirlineStatus.ACTIVE,
  })
  status: AirlineStatus;

  @Prop({ type: Date, default: null })
  deactivatedAt: Date | null;

  // The admin who created the airline.
  @Prop({ type: Types.ObjectId, required: true })
  createdBy: Types.ObjectId;

  // Added by `timestamps: true`.
  createdAt: Date;
  updatedAt: Date;
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);

AirlineSchema.index({ iataCode: 1 }, { unique: true });
// ICAO is optional, so only airlines that have one take part in the unique index.
AirlineSchema.index(
  { icaoCode: 1 },
  { unique: true, partialFilterExpression: { icaoCode: { $type: 'string' } } },
);
