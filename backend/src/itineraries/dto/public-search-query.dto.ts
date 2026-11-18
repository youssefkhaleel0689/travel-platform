import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { CITY_IDS, COUNTRY_CODES } from '../reference/reference-data';
import { MAX_DAYS } from '../itinerary-days.logic';

export class PublicSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'paris',
    description: 'Matches title, country name/code or city name',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: 'FR', description: 'Country code' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(COUNTRY_CODES)
  country?: string;

  @ApiPropertyOptional({ example: 'paris', description: 'City id' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(CITY_IDS)
  city?: string;

  @ApiPropertyOptional({ example: 3, minimum: 0, maximum: MAX_DAYS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  minDays?: number;

  @ApiPropertyOptional({ example: 10, minimum: 0, maximum: MAX_DAYS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  maxDays?: number;
}
