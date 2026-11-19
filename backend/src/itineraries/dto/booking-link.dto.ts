import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import {
  BOOKING_TYPES,
  BookingStatus,
  BookingType,
} from '../../common/bookings/booking-status';
import { PLATFORM_CURRENCY } from '../../common/money/money';
import { EXAMPLE_DAY_ID } from '../itinerary-api-docs';
import { BudgetSummaryDto } from './budget-summary-response.dto';

export const EXAMPLE_BOOKING_ID = '6720f1c2a1b2c3d4e5f60780';
export const EXAMPLE_BOOKING_LINK_ID = '6720f1c2a1b2c3d4e5f60790';

// ITN-27 (bonus): link one of your own bookings to a day of your itinerary.
export class LinkBookingDto {
  @ApiProperty({ enum: BOOKING_TYPES, example: BookingType.HOTEL })
  @IsEnum(BookingType)
  bookingType: BookingType;

  @ApiProperty({
    example: EXAMPLE_BOOKING_ID,
    description: 'Id of one of your CONFIRMED or COMPLETED bookings',
  })
  @IsMongoId()
  bookingId: string;

  @ApiProperty({
    example: EXAMPLE_DAY_ID,
    description: 'The day it belongs to',
  })
  @IsMongoId()
  dayId: string;
}

export class BookingLinkDto {
  @ApiProperty({ example: EXAMPLE_BOOKING_LINK_ID })
  id: string;

  @ApiProperty({ enum: BOOKING_TYPES, example: BookingType.HOTEL })
  bookingType: BookingType;

  @ApiProperty({ example: EXAMPLE_BOOKING_ID })
  bookingId: string;

  @ApiProperty({ example: EXAMPLE_DAY_ID })
  dayId: string;

  @ApiProperty({ example: 2 })
  dayNumber: number;

  @ApiProperty({ example: '2026-12-21' })
  date: string;

  @ApiProperty({ example: 'paris' })
  city: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'HTL-7K2Q9X',
    description: 'Null if the booking can no longer be read',
  })
  bookingReference: string | null;

  @ApiProperty({
    nullable: true,
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
    description:
      'Read live from the booking, so a later cancellation shows here',
  })
  status: BookingStatus | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '450.00',
    description: `Booking price in the platform currency (${PLATFORM_CURRENCY}), never converted (PAY-04, ITN-18)`,
  })
  totalAmount: string | null;

  @ApiProperty({ nullable: true, type: String, example: PLATFORM_CURRENCY })
  currency: string | null;

  @ApiProperty({
    example: true,
    description:
      'True while the booking is CONFIRMED or COMPLETED; a cancelled booking stops counting',
  })
  countsInBudget: boolean;

  @ApiProperty({ example: '2026-11-19T10:15:00.000Z' })
  linkedAt: Date;
}

export class LinkedBookingsSummaryDto {
  @ApiProperty({
    example: PLATFORM_CURRENCY,
    description:
      'Always the platform currency: booking prices are not converted (ITN-18)',
  })
  currency: string;

  @ApiProperty({
    example: '450.00',
    description: 'Sum of the linked bookings that count in the budget',
  })
  total: string;

  @ApiProperty({ type: [BookingLinkDto] })
  items: BookingLinkDto[];
}

// The owner's budget summary: the converted budget (ITN-14, ITN-18) plus the
// linked bookings (ITN-27), which stay in the platform currency.
export class OwnerBudgetSummaryDto extends BudgetSummaryDto {
  @ApiProperty({ type: LinkedBookingsSummaryDto })
  linkedBookings: LinkedBookingsSummaryDto;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '1250.00',
    description: `total plus linkedBookings.total. Given only when the display currency is ${PLATFORM_CURRENCY}, because booking prices are never converted; null otherwise`,
  })
  totalWithBookings: string | null;
}
