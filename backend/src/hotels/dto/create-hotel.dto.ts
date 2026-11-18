import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  COUNTRY_CODE,
  SLUG_ID,
} from '../../common/reference-data/reference-data.patterns';
import {
  HOTEL_ADDRESS_MAX_LENGTH,
  HOTEL_AMENITY_MAX_LENGTH,
  HOTEL_DESCRIPTION_MAX_LENGTH,
  HOTEL_MAX_AMENITIES,
  HOTEL_MAX_STAR_CLASS,
  HOTEL_MIN_STAR_CLASS,
  HOTEL_NAME_MAX_LENGTH,
  HotelStatus,
} from '../schemas/hotel.schema';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Trims every amenity, collapses inner whitespace and drops case-insensitive
// duplicates. Non-strings are left in place so the validators report them.
const normalizeAmenities = ({ value }: TransformFnParams): unknown => {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') {
      result.push(item);
      continue;
    }
    const amenity = item.trim().replace(/\s+/g, ' ');
    const key = amenity.toLowerCase();
    if (amenity && seen.has(key)) continue;
    seen.add(key);
    result.push(amenity);
  }
  return result;
};

// Body of POST /api/hotels (HTL-01). Admin only.
// status, rating fields, createdBy and photos are never accepted from the
// client: the ValidationPipe (whitelist + forbidNonWhitelisted) rejects them.
// Photos are added through POST /api/hotels/:id/photos (GEN-08).
export class CreateHotelDto {
  @ApiProperty({ example: 'Nile View Hotel', maxLength: HOTEL_NAME_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({
    example: '12 Corniche El Nil, Garden City',
    maxLength: HOTEL_ADDRESS_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_ADDRESS_MAX_LENGTH)
  address: string;

  @ApiProperty({
    example: 'cairo',
    description: 'Seeded city id (GEN-12). Must belong to countryId.',
  })
  @IsString()
  @Matches(SLUG_ID, { message: 'cityId must be a seeded city id' })
  cityId: string;

  @ApiProperty({ example: 'EG', description: 'Seeded country id (GEN-12).' })
  @IsString()
  @Matches(COUNTRY_CODE, { message: 'countryId must be a seeded country id' })
  countryId: string;

  @ApiPropertyOptional({
    example: 'A riverside hotel ten minutes from downtown Cairo.',
    maxLength: HOTEL_DESCRIPTION_MAX_LENGTH,
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(HOTEL_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiProperty({
    example: 4,
    type: 'integer',
    minimum: HOTEL_MIN_STAR_CLASS,
    maximum: HOTEL_MAX_STAR_CLASS,
  })
  @IsInt()
  @Min(HOTEL_MIN_STAR_CLASS)
  @Max(HOTEL_MAX_STAR_CLASS)
  starClass: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['Free Wi-Fi', 'Pool', 'Airport shuttle'],
    maxItems: HOTEL_MAX_AMENITIES,
    description:
      'Plain strings; trimmed and de-duplicated (case-insensitive) before saving.',
  })
  @Transform(normalizeAmenities)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HOTEL_MAX_AMENITIES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(HOTEL_AMENITY_MAX_LENGTH, { each: true })
  amenities?: string[];
}

// ---- Response shapes (returned by every hotels endpoint) ----

export class HotelPhotoResponseDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60720' })
  id: string;

  @ApiProperty({
    example:
      '/api/hotels/6720f1c2a1b2c3d4e5f60718/photos/6720f1c2a1b2c3d4e5f60720',
  })
  url: string;

  @ApiProperty({ example: 'image/jpeg', enum: ['image/jpeg', 'image/png'] })
  mimeType: string;

  @ApiProperty({ example: 245678 })
  sizeBytes: number;
}

export class HotelResponseDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil, Garden City' })
  address: string;

  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryId: string;

  @ApiProperty({
    example: 'A riverside hotel ten minutes from downtown Cairo.',
  })
  description: string;

  @ApiProperty({ example: 4 })
  starClass: number;

  @ApiProperty({ enum: HotelStatus, example: HotelStatus.ACTIVE })
  status: HotelStatus;

  @ApiProperty({ type: String, nullable: true, example: null })
  deactivatedAt: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4.5,
    description: 'Average of VISIBLE reviews; null while unrated.',
  })
  ratingAverage: number | null;

  @ApiProperty({ example: 12 })
  ratingCount: number;

  @ApiProperty({ type: [HotelPhotoResponseDto] })
  photos: HotelPhotoResponseDto[];

  @ApiProperty({ type: [String], example: ['Free Wi-Fi', 'Pool'] })
  amenities: string[];

  @ApiProperty({ example: '2026-11-08T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-08T10:00:00.000Z' })
  updatedAt: string;
}
