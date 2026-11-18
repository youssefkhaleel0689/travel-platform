import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { COUNTRY_CODE } from '../../common/reference-data/reference-data.patterns';

export class CreateItineraryDto {
  @ApiProperty({ example: 'Summer in Europe', maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiProperty({
    example: ['FR', 'GB'],
    description:
      'Country codes from the seeded country list (GET /api/countries); unknown codes give 400 UNKNOWN_COUNTRY',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
      : value,
  )
  @Matches(COUNTRY_CODE, {
    each: true,
    message: 'each country must be a 2-letter country code',
  })
  countries: string[];

  @ApiProperty({ example: '2026-12-20', description: 'ISO date (YYYY-MM-DD)' })
  @IsDateString({ strict: true })
  startDate: string;
}
