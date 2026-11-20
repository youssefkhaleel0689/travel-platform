import { ApiProperty } from '@nestjs/swagger';
import {
  BookingType,
  ProviderType,
} from '../../common/bookings/booking-status';
import { PolicyAcceptanceDocument } from '../schemas/policy-acceptance.schema';

// PAY-02: the stored acceptance, with its timestamp.
export class PolicyAcceptanceDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60900' })
  id: string;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  bookingId: string;

  @ApiProperty({ enum: BookingType, example: BookingType.HOTEL })
  bookingType: BookingType;

  @ApiProperty({ enum: ProviderType, example: ProviderType.HOTEL })
  providerType: ProviderType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60800' })
  providerId: string;

  @ApiProperty({ example: 1 })
  policyVersion: number;

  @ApiProperty({ example: true })
  accepted: boolean;

  @ApiProperty({ example: '2026-11-09T12:00:00.000Z' })
  acceptedAt: string;

  @ApiProperty({
    description: 'The exact terms that were accepted, kept verbatim',
    example: { checkInTime: '14:00', checkOutTime: '12:00' },
  })
  policySnapshot: Record<string, unknown>;

  static fromDocument(doc: PolicyAcceptanceDocument): PolicyAcceptanceDto {
    const dto = new PolicyAcceptanceDto();
    dto.id = doc._id.toString();
    dto.bookingId = doc.bookingId.toString();
    dto.bookingType = doc.bookingType;
    dto.providerType = doc.providerType;
    dto.providerId = doc.providerId;
    dto.policyVersion = doc.policyVersion;
    dto.accepted = doc.accepted;
    dto.acceptedAt = doc.acceptedAt.toISOString();
    dto.policySnapshot = doc.policySnapshot;
    return dto;
  }
}
