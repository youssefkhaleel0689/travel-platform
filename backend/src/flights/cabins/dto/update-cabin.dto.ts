import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsPositive,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { isSent } from '../../airlines/dto/create-airline.dto';
import { MAX_CABIN_PRICE } from './create-cabin.dto';

// Body of PATCH /flights/:id/cabins/:cabinId (FLT-04, FLT-05): any of price,
// freeBaggageCount, maxBagWeightKg. totalSeats is not here: changing the seat count needs
// the conditional update of FLT-05 and comes with that PR. category is the path value and
// cannot be changed. Written out instead of PartialType because PartialType adds
// @IsOptional(), which lets null through.
export class UpdateCabinDto {
  @ApiPropertyOptional({
    example: 179.5,
    description:
      'New price per seat in USD. Existing bookings keep the price they were made at.',
  })
  @ValidateIf(isSent)
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'price must be a number with at most 2 decimals' },
  )
  @IsPositive({ message: 'price must be greater than 0' })
  @Max(MAX_CABIN_PRICE, { message: `price must not exceed ${MAX_CABIN_PRICE}` })
  price?: number;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @ValidateIf(isSent)
  @IsInt({ message: 'freeBaggageCount must be a whole number' })
  @Min(0, { message: 'freeBaggageCount must not be negative' })
  freeBaggageCount?: number;

  @ApiPropertyOptional({ example: 30, minimum: 0.1 })
  @ValidateIf(isSent)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'maxBagWeightKg must be a number' },
  )
  @Min(0.1, { message: 'maxBagWeightKg must be at least 0.1' })
  maxBagWeightKg?: number;
}
