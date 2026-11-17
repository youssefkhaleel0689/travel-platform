import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  COUNTRY_CODE,
  SLUG_ID,
} from '../../common/reference-data/reference-data.patterns';

// hotels.status (schema section 6).
export enum HotelStatus {
  ACTIVE = 'ACTIVE',
  DEACTIVATED = 'DEACTIVATED',
}

// Shared media-upload rule (GEN-08): JPG/PNG, <= 5 MB, up to 5 photos per hotel.
export const HOTEL_MAX_PHOTOS = 5;
export const HOTEL_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const HOTEL_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export type HotelPhotoMimeType = (typeof HOTEL_PHOTO_MIME_TYPES)[number];

// Field limits of the hotel profile (HTL-01).
export const HOTEL_NAME_MAX_LENGTH = 100;
export const HOTEL_ADDRESS_MAX_LENGTH = 200;
export const HOTEL_DESCRIPTION_MAX_LENGTH = 2000;
export const HOTEL_MAX_AMENITIES = 30;
export const HOTEL_AMENITY_MAX_LENGTH = 50;
export const HOTEL_MIN_STAR_CLASS = 1;
export const HOTEL_MAX_STAR_CLASS = 5;

// Embedded photos[] (schema section 3): url; storageKey; mimeType; sizeBytes.
// Each photo keeps its own _id so it can be removed individually.
@Schema({ _id: true, versionKey: false, timestamps: false })
export class HotelPhoto {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true })
  url: string;

  // Path relative to the uploads directory, e.g. hotels/<hotelId>/<uuid>.jpg.
  @Prop({ type: String, required: true })
  storageKey: string;

  @Prop({ type: String, required: true, enum: HOTEL_PHOTO_MIME_TYPES })
  mimeType: HotelPhotoMimeType;

  @Prop({ type: Number, required: true, min: 1, max: HOTEL_PHOTO_MAX_BYTES })
  sizeBytes: number;
}

export const HotelPhotoSchema = SchemaFactory.createForClass(HotelPhoto);

export type HotelDocument = HydratedDocument<Hotel>;

// Collection "hotels" (schema section 2.4, owner B1).
// Admin creates; the assigned moderator edits (HTL-01).
// A DEACTIVATED hotel is hidden from search and cannot be booked; existing
// reservations stay valid (ACC-15).
@Schema({ collection: 'hotels', timestamps: true })
export class Hotel {
  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: HOTEL_NAME_MAX_LENGTH,
  })
  name: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: HOTEL_ADDRESS_MAX_LENGTH,
  })
  address: string;

  // Seeded string id from cities, e.g. "cairo" (GEN-12).
  @Prop({ type: String, required: true, match: SLUG_ID })
  cityId: string;

  // Seeded string id from countries, e.g. "EG" (GEN-12).
  @Prop({ type: String, required: true, match: COUNTRY_CODE })
  countryId: string;

  @Prop({
    type: String,
    trim: true,
    default: '',
    maxlength: HOTEL_DESCRIPTION_MAX_LENGTH,
  })
  description: string;

  @Prop({
    type: Number,
    required: true,
    min: HOTEL_MIN_STAR_CLASS,
    max: HOTEL_MAX_STAR_CLASS,
    validate: {
      validator: Number.isInteger,
      message: 'starClass must be an integer',
    },
  })
  starClass: number;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(HotelStatus),
    default: HotelStatus.ACTIVE,
  })
  status: HotelStatus;

  @Prop({ type: Date, default: null })
  deactivatedAt: Date | null;

  // reviewAggregate (schema section 4): derived from VISIBLE reviews only and
  // recalculated by the reviews code (B2). null while the hotel is unrated.
  @Prop({ type: Number, default: null, min: 1, max: 5 })
  ratingAverage: number | null;

  @Prop({ type: Number, default: 0, min: 0 })
  ratingCount: number;

  // The admin who created the hotel.
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

  // Embedded amenities[]: plain strings.
  @Prop({ type: [String], default: [] })
  amenities: string[];

  // Set by timestamps: true.
  createdAt: Date;
  updatedAt: Date;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);

// Hotel search (HTL-11) filters active hotels by seeded city or country.
HotelSchema.index({ status: 1, cityId: 1 });
HotelSchema.index({ status: 1, countryId: 1 });
// Admin list, newest first.
HotelSchema.index({ createdAt: -1 });
