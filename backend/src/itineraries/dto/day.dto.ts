import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CITY_IDS } from '../reference/reference-data';

export class CreateDayDto {
  @ApiProperty({ example: 'paris', description: 'City id from the city list' })
  @IsIn(CITY_IDS)
  city: string;

  @ApiPropertyOptional({ example: 'Arrive and walk along the Seine' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateDayDto extends PartialType(CreateDayDto) {}

export class ReorderDaysDto {
  @ApiProperty({ description: 'The day to move' })
  @IsMongoId()
  dayId: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'New position of that day (1 = first day)',
  })
  @IsInt()
  @Min(1)
  position: number;
}
