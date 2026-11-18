import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CURRENCY_CODE } from '../../common/reference-data/reference-data.patterns';
import { MAX_ITINERARY_AMOUNT } from './money-limits';

export class CreateActivityDto {
  @ApiProperty({ example: 'Eiffel Tower visit', maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: '09:30', description: 'HH:mm (24h)' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time must be HH:mm' })
  time?: string;

  @ApiPropertyOptional({
    example: 25.5,
    minimum: 0,
    description: 'At most 2 decimals; returned as a string such as "25.50"',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_ITINERARY_AMOUNT)
  cost?: number;

  @ApiPropertyOptional({ example: 'EUR', description: 'Required with cost' })
  @ValidateIf((o: CreateActivityDto) => o.cost !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(CURRENCY_CODE, {
    message: 'currency must be a 3-letter currency code',
  })
  currency?: string;
}

export class UpdateActivityDto extends PartialType(CreateActivityDto) {}
