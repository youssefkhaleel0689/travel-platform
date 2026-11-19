import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const MAX_CANCELLATION_TIERS = 20;

// One tier of the cancellation policy (FLT-09); also the response shape of a tier.
export class AirlineCancellationTierDto {
  @ApiProperty({
    example: 7,
    minimum: 0,
    description:
      'Days before departure at which this tier starts to apply. Whole number, unique within the policy.',
  })
  @IsInt({ message: 'daysBeforeDeparture must be a whole number' })
  @Min(0, { message: 'daysBeforeDeparture must not be negative' })
  daysBeforeDeparture: number;

  @ApiProperty({
    example: 100,
    minimum: 0,
    maximum: 100,
    description: 'Refund percentage, 0 to 100, at most 2 decimals.',
  })
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'refundPercentage must be a number with at most 2 decimals' },
  )
  @Min(0, { message: 'refundPercentage must not be below 0' })
  @Max(100, { message: 'refundPercentage must not be above 100' })
  refundPercentage: number;
}

// Each daysBeforeDeparture threshold may appear once (FLT-09).
@ValidatorConstraint({ name: 'uniqueThresholds', async: false })
class UniqueThresholds implements ValidatorConstraintInterface {
  validate(tiers: unknown): boolean {
    if (!Array.isArray(tiers)) {
      return true; // IsArray reports that
    }
    const days = tiers.map(
      (tier: { daysBeforeDeparture?: unknown }) => tier?.daysBeforeDeparture,
    );
    return new Set(days).size === days.length;
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'each daysBeforeDeparture threshold may be used only once';
  }
}

// Body of PUT /airlines/:id/cancellation-policy (FLT-09). The list replaces the whole set
// of tiers; an empty list means no tier applies, so every refund is 0%.
export class CancellationPolicyDto {
  @ApiProperty({
    type: [AirlineCancellationTierDto],
    example: [
      { daysBeforeDeparture: 14, refundPercentage: 100 },
      { daysBeforeDeparture: 7, refundPercentage: 50 },
      { daysBeforeDeparture: 0, refundPercentage: 0 },
    ],
    description:
      'The tier with the highest threshold not exceeding the days remaining applies; if none applies the refund is 0%.',
  })
  @IsArray({ message: 'cancellationTiers must be a list' })
  @ArrayMaxSize(MAX_CANCELLATION_TIERS, {
    message: `cancellationTiers must have at most ${MAX_CANCELLATION_TIERS} tiers`,
  })
  @ValidateNested({ each: true })
  @Type(() => AirlineCancellationTierDto)
  @Validate(UniqueThresholds)
  cancellationTiers: AirlineCancellationTierDto[];
}
