import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SUPPORTED_CURRENCIES } from '../reference/reference-data';

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

  @ApiPropertyOptional({ example: 25.5, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({ example: 'EUR', description: 'Required with cost' })
  @ValidateIf((o: CreateActivityDto) => o.cost !== undefined)
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;
}

export class UpdateActivityDto extends PartialType(CreateActivityDto) {}
