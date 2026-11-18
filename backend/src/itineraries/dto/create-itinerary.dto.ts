import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { COUNTRY_CODES } from '../reference/reference-data';

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
    description: 'Country codes from the predefined country list',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsIn(COUNTRY_CODES, { each: true })
  countries: string[];

  @ApiProperty({ example: '2026-12-20', description: 'ISO date (YYYY-MM-DD)' })
  @IsDateString({ strict: true })
  startDate: string;
}
