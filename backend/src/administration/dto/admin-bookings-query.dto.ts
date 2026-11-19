import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import {
  BookingStatus,
  BookingType,
} from '../../common/bookings/booking-status';
import { IsLocalDate } from '../../common/time/local-date-time.validators';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';

/**
 * ACC-17: how an admin narrows the list of every booking - by type, status and
 * the dates the bookings were made, plus the booking reference, which is what
 * an admin has in hand when a traveller asks about one booking.
 *
 * The date range is written as calendar days in UTC (`2026-11-01`) rather than
 * as instants: an admin thinks in days, and both ends then mean the same thing
 * whatever time zone the browser is in.
 */
export class AdminBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BookingType,
    description: 'Only flight bookings or only hotel reservations.',
  })
  @IsOptional()
  @IsEnum(BookingType)
  type?: BookingType;

  @ApiPropertyOptional({
    enum: BookingStatus,
    description: 'The GEN-11 lifecycle state of the booking.',
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description:
      'First day of the range, in UTC. Bookings made on this day are included.',
  })
  @IsOptional()
  @IsLocalDate()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description:
      'Last day of the range, in UTC. The whole day is included, so from and ' +
      'to may name the same day.',
  })
  @IsOptional()
  @IsLocalDate()
  to?: string;

  @ApiPropertyOptional({
    example: 'K7M2QX',
    description:
      'The exact booking reference, which a confirmed booking carries. Case ' +
      'is ignored; an unpaid booking has none and can never match.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{4,20}$/, {
    message: 'reference must be 4 to 20 letters or digits',
  })
  reference?: string;
}
