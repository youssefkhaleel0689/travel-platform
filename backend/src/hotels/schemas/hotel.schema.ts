import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  COUNTRY_CODE,
  SLUG_ID,
} from '../../common/reference-data/reference-data.patterns';

// hotels.status (schema section 6). A DEACTIVATED hotel is hidden from search
// and cannot be booked; existing reservations stay valid (ACC-15).
export enum HotelStatus {
  ACTIVE = 'ACTIVE',
  DEACTIVATED = 'DEACTIVATED',
}

export const HOTEL_NAME_MAX_LENGTH = 100;
export const HOTEL_ADDRESS_MAX_LENGTH = 200;
export const HOTEL_DESCRIPTION_MAX_LENGTH = 2000;
export const HOTEL_MAX_PHOTOS = 5;
export const HOTEL_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const HOTEL_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export const HOTEL_MIN_STAR_CLASS = 1;
export const HOTEL_MAX_STAR_CLASS = 5;

@Schema({ _id: true, versionKey: false, timestamps: false })
export class HotelPhoto {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: String, required: true })
  storageKey: string;

  @Prop({ type: String, required: true, enum: HOTEL_PHOTO_MIME_TYPES })
  mimeType: string;

  @Prop({ type: Number, required: true, min: 1, max: HOTEL_PHOTO_MAX_BYTES })
  sizeBytes: number;
}

export const HotelPhotoSchema = SchemaFactory.createForClass(HotelPhoto);

export type HotelDocument = HydratedDocument<Hotel>;

// Collection "hotels" (schema section 2.4). Field names are kept identical to
// the hotel-core schema so B1's branch and this one read the same documents.
@Schema({ collection: 'hotels', timestamps: true })
export class Hotel {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: HOTEL_NAME_MAX_LENGTH })
  name: string;

  @Prop({ type: String, required: true, trim: true, maxlength: HOTEL_ADDRESS_MAX_LENGTH })
  address: string;

  // Seeded string ids from reference data, e.g. "cairo" and "EG" (GEN-12).
  @Prop({ type: String, required: true, match: SLUG_ID })
  cityId: string;

  @Prop({ type: String, required: true, match: COUNTRY_CODE })
  countryId: string;

  @Prop({ type: String, trim: true, default: '', maxlength: HOTEL_DESCRIPTION_MAX_LENGTH })
  description: string;

  @Prop({
    type: Number,
    required: true,
    min: HOTEL_MIN_STAR_CLASS,
    max: HOTEL_MAX_STAR_CLASS,
    validate: { validator: Number.isInteger, message: 'starClass must be an integer' },
  })
  starClass: number;

  @Prop({ type: String, required: true, enum: Object.values(HotelStatus), default: HotelStatus.ACTIVE })
  status: HotelStatus;

  @Prop({ type: Date, default: null })
  deactivatedAt: Date | null;

  // Derived from VISIBLE reviews only; null while the hotel is unrated.
  @Prop({ type: Number, default: null, min: 1, max: 5 })
  ratingAverage: number | null;

  @Prop({ type: Number, default: 0, min: 0 })
  ratingCount: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({
    type: [HotelPhotoSchema],
    default: [],
    validate: {
      validator: (photos: unknown[]) => photos.length <= HOTEL_MAX_PHOTOS,
      message: `A hotel can have at most ${HOTEL_MAX_PHOTOS} photos`,
    },
  })
  photos: HotelPhoto[];

  @Prop({ type: [String], default: [] })
  amenities: string[];

  createdAt: Date;
  updatedAt: Date;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);

// Hotel search (HTL-11) filters active hotels by seeded city or country.
HotelSchema.index({ status: 1, cityId: 1 });
HotelSchema.index({ status: 1, countryId: 1 });
HotelSchema.index({ createdAt: -1 });
