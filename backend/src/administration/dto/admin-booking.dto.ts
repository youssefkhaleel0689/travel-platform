import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from '../../common/bookings/booking-status';
import type { AdminBookingRow } from '../../common/bookings/bookings.port';
import type { UserContact } from '../../auth/users/users.service';

/** Who made the booking (ACC-17). Admin-only, so it may carry the email. */
export class AdminBookingUserDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Taher Khalaf',
    description: 'null when the account has since been deleted',
  })
  name: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'taher@example.com',
    description: 'null when the account has since been deleted',
  })
  email: string | null;
}

/** The airline or the hotel the booking is with (ACC-17). */
export class AdminBookingProviderDto {
  @ApiProperty({ enum: ProviderType, example: ProviderType.AIRLINE })
  type: ProviderType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60719' })
  id: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'KD Airways',
    description: 'null when the airline or hotel row has since been removed',
  })
  name: string | null;
}

/**
 * ACC-17: one row of the admin booking list - reference, user, provider,
 * dates, amount and status - built the same way for a flight booking and for a
 * hotel reservation, which live in two collections owned by two modules.
 *
 * It maps from AdminBookingRow, the shape BookingsPort hands out, so the admin
 * list never reads either booking collection itself.
 */
export class AdminBookingDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60720' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  type: BookingType;

  @ApiPropertyOptional({
    nullable: true,
    example: 'K7M2QX',
    description: 'Generated on payment, so null while the booking is unpaid',
  })
  reference: string | null;

  @ApiProperty({ type: AdminBookingUserDto })
  user: AdminBookingUserDto;

  @ApiProperty({ type: AdminBookingProviderDto })
  provider: AdminBookingProviderDto;

  @ApiProperty({
    example: '2026-12-20T06:30:00.000Z',
    description: 'Departure of the first flight, or the check-in day',
  })
  startsAt: string;

  @ApiProperty({
    example: '2026-12-20T10:30:00.000Z',
    description: 'Arrival of the last flight, or the check-out day',
  })
  endsAt: string;

  @ApiProperty({
    example: '420.00',
    description: 'A string, never a number: money is Decimal128 (PAY-04)',
  })
  amount: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  status: BookingStatus;

  @ApiProperty({
    example: '2026-11-19T08:00:00.000Z',
    description: 'When the booking was made; the list is newest first',
  })
  bookedAt: string;

  static from(
    row: AdminBookingRow,
    owner: UserContact | undefined,
  ): AdminBookingDto {
    const dto = new AdminBookingDto();
    dto.id = row.bookingId;
    dto.type = row.bookingType;
    dto.reference = row.bookingReference;
    dto.user = {
      id: row.userId,
      name: owner?.name ?? null,
      email: owner?.email ?? null,
    };
    dto.provider = {
      type: row.providerType,
      id: row.providerId,
      name: row.providerName,
    };
    dto.startsAt = row.startsAt.toISOString();
    dto.endsAt = row.endsAt.toISOString();
    dto.amount = row.totalAmount;
    dto.currency = row.currency;
    dto.status = row.status;
    dto.bookedAt = row.createdAt.toISOString();
    return dto;
  }
}
