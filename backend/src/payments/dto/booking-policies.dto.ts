import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BookingType,
  ProviderType,
} from '../../common/bookings/booking-status';
import { BookingPolicies } from '../../common/bookings/bookings.port';
import { PolicyAcceptanceDocument } from '../schemas/policy-acceptance.schema';

// PAY-02: what the user must read before paying, and whether they already
// accepted it.
export class BookingPoliciesDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  bookingId: string;

  @ApiProperty({ enum: BookingType, example: BookingType.HOTEL })
  bookingType: BookingType;

  @ApiProperty({ enum: ProviderType, example: ProviderType.HOTEL })
  providerType: ProviderType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60800' })
  providerId: string;

  @ApiProperty({
    example: 1,
    description: 'Echo this back when accepting the policies',
  })
  policyVersion: number;

  @ApiProperty({
    description:
      "The provider's terms. An airline sends its baggage rules and " +
      'cancellation tiers; a hotel sends its cancellation tiers and its ' +
      'check-in and check-out times.',
    example: {
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [
        { daysBeforeCheckIn: 7, refundPercentage: 100 },
        { daysBeforeCheckIn: 2, refundPercentage: 50 },
      ],
    },
  })
  policySnapshot: Record<string, unknown>;

  @ApiProperty({
    example: false,
    description: 'true once these exact terms have been accepted (PAY-02)',
  })
  accepted: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description: 'When they were accepted; null while they have not been',
  })
  acceptedAt: string | null;

  static from(
    policies: BookingPolicies,
    acceptance: PolicyAcceptanceDocument | null,
  ): BookingPoliciesDto {
    const dto = new BookingPoliciesDto();
    dto.bookingId = policies.bookingId;
    dto.bookingType = policies.bookingType;
    dto.providerType = policies.providerType;
    dto.providerId = policies.providerId;
    dto.policyVersion = policies.policyVersion;
    dto.policySnapshot = policies.policySnapshot;
    dto.accepted = acceptance !== null;
    dto.acceptedAt = acceptance ? acceptance.acceptedAt.toISOString() : null;
    return dto;
  }
}
