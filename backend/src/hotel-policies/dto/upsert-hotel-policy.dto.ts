import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class HotelCancellationTierDto {
  @ApiProperty({ example: 7, description: 'Integer >= 0' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  daysBeforeCheckIn!: number;

  @ApiProperty({ example: 50, description: '0-100, up to 2 decimals' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  refundPercentage!: number;
}

export class UpsertHotelPolicyDto {
  @ApiProperty({ example: '14:00' })
  @IsString()
  @Matches(HHMM, { message: 'checkInTime must be HH:mm (24-hour)' })
  checkInTime!: string;

  @ApiProperty({ example: '12:00' })
  @IsString()
  @Matches(HHMM, { message: 'checkOutTime must be HH:mm (24-hour)' })
  checkOutTime!: string;

  @ApiProperty({
    type: [HotelCancellationTierDto],
    description: 'Unique daysBeforeCheckIn thresholds',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HotelCancellationTierDto)
  cancellationTiers!: HotelCancellationTierDto[];
}
