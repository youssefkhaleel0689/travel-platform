import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PageMetaDto } from '../../../common/pagination/dto/page.dto';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { BookingStatus } from '../../../common/bookings/booking-status';
import { PassengerType } from '../../schemas/flight-booking.schema';
import { CabinCategory, FlightStatus } from '../../schemas/flight.schema';

// FLT-29: the bookings an airline moderator sees on one of the airline's flights. A booking
// that never got paid (PENDING_PAYMENT, EXPIRED) is not a booking of the flight yet, so it
// never shows here.
export const AIRLINE_VISIBLE_STATUSES = [
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
] as const;

// The statuses whose passengers fly: the passenger list (CSV) leaves cancelled ones out.
export const AIRLINE_PASSENGER_STATUSES = [
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
] as const;

export class ListFlightBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AIRLINE_VISIBLE_STATUSES,
    description:
      'Only bookings in this status. Without it CONFIRMED, COMPLETED and CANCELLED bookings are listed.',
    example: BookingStatus.CONFIRMED,
  })
  @IsOptional()
  @IsIn(AIRLINE_VISIBLE_STATUSES)
  status?: BookingStatus;
}

export class FlightBookingPassengerDto {
  @ApiProperty({ example: 'Amira Hassan' })
  fullName: string;

  @ApiProperty({ enum: PassengerType, example: PassengerType.ADULT })
  passengerType: PassengerType;
}

export class AirlineFlightBookingDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60720' })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'K7M2QX',
    description: 'Set once the payment is confirmed.',
  })
  bookingReference: string | null;

  @ApiProperty({ enum: AIRLINE_VISIBLE_STATUSES, example: 'CONFIRMED' })
  status: BookingStatus;

  @ApiProperty({
    enum: CabinCategory,
    example: CabinCategory.ECONOMY,
    description: 'The cabin booked on this flight.',
  })
  cabin: CabinCategory;

  @ApiProperty({
    example: 2,
    description:
      'Seats this booking takes on this flight (adults and children; infants sit on a lap).',
  })
  seats: number;

  @ApiProperty({ example: 3, description: 'All passengers, infants included.' })
  passengerCount: number;

  @ApiProperty({ type: [FlightBookingPassengerDto] })
  passengers: FlightBookingPassengerDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-18T09:15:00.000Z',
  })
  confirmedAt: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  cancelledAt: string | null;
}

export class AirlineFlightSummaryDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

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

  @ApiProperty({ enum: FlightStatus, example: FlightStatus.SCHEDULED })
  status: FlightStatus;
}

export class CabinSeatsDto {
  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  category: CabinCategory;

  @ApiProperty({ example: 150 })
  totalSeats: number;

  @ApiProperty({ example: 40 })
  bookedSeats: number;

  @ApiProperty({ example: 2, description: 'Seats of unpaid holds.' })
  heldSeats: number;

  @ApiProperty({
    example: 108,
    description: 'totalSeats minus bookedSeats minus heldSeats.',
  })
  remainingSeats: number;
}

export class AirlineFlightBookingsPageDto {
  @ApiProperty({ type: [AirlineFlightBookingDto] })
  items: AirlineFlightBookingDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class AirlineFlightBookingsDto {
  @ApiProperty({ type: AirlineFlightSummaryDto })
  flight: AirlineFlightSummaryDto;

  @ApiProperty({
    type: [CabinSeatsDto],
    description: 'Seats remaining per cabin category.',
  })
  seats: CabinSeatsDto[];

  @ApiProperty({
    type: AirlineFlightBookingsPageDto,
    description: 'One page (10) of the flight bookings, oldest first.',
  })
  bookings: AirlineFlightBookingsPageDto;
}
