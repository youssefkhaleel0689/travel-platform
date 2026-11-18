import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsEnum, IsIn, IsMongoId, IsNumber, Min } from 'class-validator';
import { TransportMode } from '../schemas/itinerary.schema';
import { CITY_IDS, SUPPORTED_CURRENCIES } from '../reference/reference-data';

export class CreateTransportCostDto {
  @ApiProperty({ enum: TransportMode, example: TransportMode.TRAIN })
  @IsEnum(TransportMode)
  mode: TransportMode;

  @ApiProperty({ example: 'london' })
  @IsIn(CITY_IDS)
  fromCity: string;

  @ApiProperty({ example: 'paris' })
  @IsIn(CITY_IDS)
  toCity: string;

  @ApiProperty({ example: 120, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'GBP' })
  @IsIn(SUPPORTED_CURRENCIES)
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
