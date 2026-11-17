import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';
import { trimUpper } from '../../airlines/dto/create-airline.dto';
import { CabinCategory } from '../../schemas/flight.schema';

// Sanity ceiling so a typo cannot store an absurd price. Not a business rule.
export const MAX_CABIN_PRICE = 1_000_000;

// Body of POST /flights/:id/cabins (FLT-04). Not accepted from the client, on purpose:
// bookedSeats and heldSeats (only SeatInventoryService changes them, FLT-22) and the
// airline or flight status.
export class CreateCabinDto {
  @ApiProperty({
    enum: CabinCategory,
    example: CabinCategory.ECONOMY,
    description: 'Each category can be used once per flight.',
  })
  @Transform(trimUpper)
  @IsEnum(CabinCategory, {
    message: `category must be one of ${Object.values(CabinCategory).join(', ')}`,
  })
  category: CabinCategory;

  @ApiProperty({
    example: 150,
    minimum: 1,
    description: 'Whole number of seats, greater than 0.',
  })
  @IsInt({ message: 'totalSeats must be a whole number' })
  @Min(1, { message: 'totalSeats must be greater than 0' })
  totalSeats: number;

  @ApiProperty({
    example: 199.99,
    description: 'Price per seat in USD, greater than 0, at most 2 decimals.',
  })
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'price must be a number with at most 2 decimals' },
  )
  @IsPositive({ message: 'price must be greater than 0' })
  @Max(MAX_CABIN_PRICE, { message: `price must not exceed ${MAX_CABIN_PRICE}` })
  price: number;

  @ApiProperty({
    example: 1,
    minimum: 0,
    description: 'Free checked bags per passenger. 0 means no free bag.',
  })
  @IsInt({ message: 'freeBaggageCount must be a whole number' })
  @Min(0, { message: 'freeBaggageCount must not be negative' })
  freeBaggageCount: number;

  @ApiProperty({
    example: 23,
    minimum: 0.1,
    description:
      'Maximum weight of one bag in kg. Extra bags use the same limit (FLT-08).',
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'maxBagWeightKg must be a number' },
  )
  @Min(0.1, { message: 'maxBagWeightKg must be at least 0.1' })
  maxBagWeightKg: number;
}
