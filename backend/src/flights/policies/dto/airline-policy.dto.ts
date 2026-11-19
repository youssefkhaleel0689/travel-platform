import { ApiProperty } from '@nestjs/swagger';
import { AirlineCancellationTierDto } from './cancellation-policy.dto';

// Response of the policy endpoints (FLT-08, FLT-09). A part that has not been defined yet
// is null (baggage) or an empty list (tiers).
export class AirlinePolicyDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  airlineId: string;

  @ApiProperty({
    example: '25.00',
    nullable: true,
    type: String,
    description:
      'Price of one extra bag in USD; null until the baggage policy is set.',
  })
  extraBagPrice: string | null;

  @ApiProperty({
    example: 2,
    nullable: true,
    type: Number,
    description:
      'Extra bags allowed per passenger; null until the baggage policy is set.',
  })
  maxExtraBagsPerPassenger: number | null;

  @ApiProperty({
    type: [AirlineCancellationTierDto],
    description: 'Sorted by daysBeforeDeparture, highest first.',
  })
  cancellationTiers: AirlineCancellationTierDto[];

  @ApiProperty({ example: 1, description: 'Goes up by 1 on every change.' })
  version: number;

  @ApiProperty({ example: '2026-11-17T10:00:00.000Z' })
  updatedAt: string;
}
