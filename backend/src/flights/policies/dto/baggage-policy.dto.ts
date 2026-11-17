import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';

// Sanity ceilings so a typo cannot store an absurd value. Not business rules.
export const MAX_EXTRA_BAG_PRICE = 10_000;
export const MAX_EXTRA_BAGS_PER_PASSENGER = 20;

// Body of PUT /airlines/:id/baggage-policy (FLT-08). Both fields are required: the endpoint
// replaces the baggage part of the policy. The maximum weight of an extra bag is not sent:
// it equals the maxBagWeightKg of the booked cabin (FLT-04).
export class BaggagePolicyDto {
  @ApiProperty({
    example: 25,
    description:
      'Price of one extra bag in USD, greater than 0, at most 2 decimals.',
  })
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'extraBagPrice must be a number with at most 2 decimals' },
  )
  @IsPositive({ message: 'extraBagPrice must be greater than 0' })
  @Max(MAX_EXTRA_BAG_PRICE, {
    message: `extraBagPrice must not exceed ${MAX_EXTRA_BAG_PRICE}`,
  })
  extraBagPrice: number;

  @ApiProperty({
    example: 2,
    minimum: 0,
    maximum: MAX_EXTRA_BAGS_PER_PASSENGER,
    description: 'Extra bags allowed per passenger. 0 means no extra bags.',
  })
  @IsInt({ message: 'maxExtraBagsPerPassenger must be a whole number' })
  @Min(0, { message: 'maxExtraBagsPerPassenger must not be negative' })
  @Max(MAX_EXTRA_BAGS_PER_PASSENGER, {
    message: `maxExtraBagsPerPassenger must not exceed ${MAX_EXTRA_BAGS_PER_PASSENGER}`,
  })
  maxExtraBagsPerPassenger: number;
}
