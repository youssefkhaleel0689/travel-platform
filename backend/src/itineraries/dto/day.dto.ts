import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SLUG_ID } from '../../common/reference-data/reference-data.patterns';

export class CreateDayDto {
  @ApiProperty({
    example: 'paris',
    description:
      'City id from the seeded city list (GET /api/cities); unknown ids give 400 UNKNOWN_CITY',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(SLUG_ID, { message: 'city must be a city id such as paris' })
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
