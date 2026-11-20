import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { TransportMode } from '../schemas/itinerary.schema';
import {
  CURRENCY_CODE,
  SLUG_ID,
} from '../../common/reference-data/reference-data.patterns';
import { MAX_ITINERARY_AMOUNT } from './money-limits';

const cityId = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateTransportCostDto {
  @ApiProperty({ enum: TransportMode, example: TransportMode.TRAIN })
  @IsEnum(TransportMode)
  mode: TransportMode;

  @ApiProperty({ example: 'london', description: 'Seeded city id' })
  @Transform(cityId)
  @IsString()
  @Matches(SLUG_ID, { message: 'fromCity must be a city id such as london' })
  fromCity: string;

  @ApiProperty({ example: 'paris', description: 'Seeded city id' })
  @Transform(cityId)
  @IsString()
  @Matches(SLUG_ID, { message: 'toCity must be a city id such as paris' })
  toCity: string;

  @ApiProperty({
    example: 120,
    minimum: 0,
    description:
      'Amount in `currency`, at most 2 decimals. Stored as Decimal128 and returned as a string.',
  })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_ITINERARY_AMOUNT)
  amount: number;

  @ApiProperty({ example: 'GBP', description: 'A seeded currency' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(CURRENCY_CODE, {
    message: 'currency must be a 3-letter currency code',
  })
  currency: string;

  @ApiProperty({
    description: 'The day of the itinerary this travel belongs to',
  })
  @IsMongoId()
  dayId: string;
}

export class UpdateTransportCostDto extends PartialType(
  CreateTransportCostDto,
) {}
