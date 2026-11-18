import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { BookingStatus } from '../../../common/bookings/booking-status';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { PageMetaDto } from '../../../common/pagination/dto/page.dto';
import { trimText } from '../../../common/validation/text-transforms';
import { isSent } from '../../airlines/dto/create-airline.dto';
import { TripType } from '../../schemas/flight-booking.schema';
import { CabinCategory } from '../../schemas/flight.schema';

// FLT-25: the three groups of "my flight bookings". A booking is UPCOMING while it is
// CONFIRMED and one of its flights has not left yet, PAST once it is COMPLETED or every
// flight has left, and CANCELLED once it was cancelled by the user (FLT-26) or the airline
// (FLT-06). An unpaid hold is not a booking yet (GEN-11); GET /api/flight-bookings/{id}
// shows it.
export enum FlightBookingGroup {
  UPCOMING = 'UPCOMING',
  PAST = 'PAST',
  CANCELLED = 'CANCELLED',
}

export class ListMyFlightBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FlightBookingGroup,
    default: FlightBookingGroup.UPCOMING,
    description:
      'UPCOMING: paid, a flight still ahead (soonest first). PAST: completed or every flight left (latest first). CANCELLED: cancelled by you or by the airline (latest first).',
  })
  @IsOptional()
  @IsIn(Object.values(FlightBookingGroup))
  group: FlightBookingGroup = FlightBookingGroup.UPCOMING;
}

export class MyFlightBookingSegmentDto {
  @ApiProperty({ example: 'MS777' })
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  departureAirportId: string;

  @ApiProperty({ example: 'DXB' })
  arrivalAirportId: string;

  @ApiProperty({ example: '2026-12-20T06:30:00.000Z' })
  departureAtUtc: string;

  @ApiProperty({ example: '2026-12-20T10:30:00.000Z' })
  arrivalAtUtc: string;

  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  cabin: CabinCategory;
}

export class MyFlightBookingRefundDto {
  @ApiProperty({
    example: 50,
    description: 'The cancellation tier that applied.',
  })
  percentage: number;

  @ApiProperty({ example: '199.99', description: 'Refund in USD.' })
  amount: string;
}

export class MyFlightBookingDto {
  @ApiProperty({
    example: '6720f1c2a1b2c3d4e5f60720',
    description: 'Open it with GET /api/flight-bookings/{id}.',
  })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'K7M2QX' })
  bookingReference: string | null;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  status: BookingStatus;

  @ApiProperty({ enum: TripType, example: TripType.ONE_WAY })
  tripType: TripType;

  @ApiProperty({ type: [MyFlightBookingSegmentDto] })
  segments: MyFlightBookingSegmentDto[];

  @ApiProperty({ example: 2, description: 'All passengers, infants included.' })
  passengerCount: number;

  @ApiProperty({ example: '399.98', description: 'Total paid in USD.' })
  total: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-18T09:15:00.000Z',
  })
  confirmedAt: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelledAt: string | null;

  @ApiProperty({
    type: MyFlightBookingRefundDto,
    nullable: true,
    description: 'Only on a cancelled booking.',
  })
  refund: MyFlightBookingRefundDto | null;
}

export class MyFlightBookingsPageDto {
  @ApiProperty({ type: [MyFlightBookingDto] })
  items: MyFlightBookingDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class MyFlightBookingCountsDto {
  @ApiProperty({ example: 2 })
  upcoming: number;

  @ApiProperty({ example: 5 })
  past: number;

  @ApiProperty({ example: 1 })
  cancelled: number;
}

export class MyFlightBookingsDto {
  @ApiProperty({
    enum: FlightBookingGroup,
    example: FlightBookingGroup.UPCOMING,
  })
  group: FlightBookingGroup;

  @ApiProperty({
    type: MyFlightBookingCountsDto,
    description: 'How many bookings each group holds, for the tabs.',
  })
  counts: MyFlightBookingCountsDto;

  @ApiProperty({
    type: MyFlightBookingsPageDto,
    description: 'One page (10) of the chosen group.',
  })
  bookings: MyFlightBookingsPageDto;
}

export class CancellationTierDto {
  @ApiProperty({ example: 7 })
  daysBeforeDeparture: number;

  @ApiProperty({ example: 50 })
  refundPercentage: number;
}

// Why a booking cannot be cancelled (FLT-26).
export enum CancellationBlock {
  NOT_CONFIRMED = 'NOT_CONFIRMED',
  DEPARTURE_PASSED = 'DEPARTURE_PASSED',
}

export class CancellationQuoteDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60720' })
  bookingId: string;

  @ApiProperty({ type: String, nullable: true, example: 'K7M2QX' })
  bookingReference: string | null;

  @ApiProperty({
    example: true,
    description:
      'True only for a CONFIRMED booking whose first flight has not left.',
  })
  canCancel: boolean;

  @ApiProperty({
    enum: CancellationBlock,
    nullable: true,
    example: null,
    description: 'Why canCancel is false.',
  })
  blockedReason: CancellationBlock | null;

  @ApiProperty({
    example: '2026-12-20T06:30:00.000Z',
    description:
      'The first flight. A round trip is cancelled as a whole, with the outbound tier.',
  })
  departureAtUtc: string;

  @ApiProperty({
    example: 12,
    description:
      'Whole 24-hour periods from now to the departure; 0 once it has left.',
  })
  daysRemaining: number;

  @ApiProperty({ example: 50, description: 'The tier that applies today.' })
  refundPercentage: number;

  @ApiProperty({
    example: '199.99',
    description: 'Refund in USD if you cancel now.',
  })
  refundAmount: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    type: [CancellationTierDto],
    description:
      'The airline terms this booking was made under, highest threshold first.',
  })
  tiers: CancellationTierDto[];
}

export class CancelFlightBookingDto {
  @ApiPropertyOptional({
    example: 'My plans changed',
    maxLength: 500,
    description: 'Optional reason, kept on the booking and the refund.',
  })
  @Transform(trimText)
  @ValidateIf(isSent)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CancelledFlightBookingDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60720' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'K7M2QX' })
  bookingReference: string | null;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CANCELLED })
  status: BookingStatus;

  @ApiProperty({ example: '2026-11-19T08:00:00.000Z' })
  cancelledAt: string;

  @ApiProperty({ example: 50 })
  refundPercentage: number;

  @ApiProperty({
    example: '199.99',
    description:
      'The refund in USD. 0.00 when the tier is 0% or no payment was captured.',
  })
  refundAmount: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '6720f1c2a1b2c3d4e5f60730',
    description:
      'The refund record (PAY-03); null when nothing is refunded. If the payment provider fails the refund is kept as FAILED and can be retried; the cancellation stands.',
  })
  refundId: string | null;
}
