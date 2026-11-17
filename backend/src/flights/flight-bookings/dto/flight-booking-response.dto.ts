import { ApiProperty } from '@nestjs/swagger';
import { PassengerType, TripType } from '../../schemas/flight-booking.schema';
import { CabinCategory } from '../../schemas/flight.schema';

// Response shapes of the flight booking endpoints (FLT-19, FLT-21, FLT-22). Money is a
// decimal string in USD (PAY-04); times are UTC instants plus local times at each airport.

export class FlightBookingSegmentDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60719' })
  flightId: string;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  airlineId: string;

  @ApiProperty({ example: 'MS910' })
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  departureAirportId: string;

  @ApiProperty({ example: 'DXB' })
  arrivalAirportId: string;

  @ApiProperty({
    example: '2026-12-20T08:30:00+02:00',
    description: 'Local time at the departure airport, with its UTC offset.',
  })
  departureLocalTime: string;

  @ApiProperty({
    example: '2026-12-20T14:30:00+04:00',
    description: 'Local time at the arrival airport, with its UTC offset.',
  })
  arrivalLocalTime: string;

  @ApiProperty({ example: '2026-12-20T06:30:00.000Z' })
  departureAtUtc: string;

  @ApiProperty({ example: '2026-12-20T10:30:00.000Z' })
  arrivalAtUtc: string;

  @ApiProperty({ example: 240 })
  durationMinutes: number;

  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  cabin: CabinCategory;

  @ApiProperty({
    example: '199.99',
    description: 'Fare per adult or child; an infant pays 10% of it.',
  })
  pricePerSeat: string;

  @ApiProperty({ example: 1, description: 'Free bags per passenger.' })
  freeBaggageCount: number;

  @ApiProperty({
    example: 23,
    description: 'Maximum weight of every bag, free or extra (FLT-08).',
  })
  maxBagWeightKg: number;
}

export class FlightBookingExtraBagsDto {
  @ApiProperty({ example: 1 })
  count: number;

  @ApiProperty({ example: 20 })
  weightKg: number;

  @ApiProperty({
    example: '50.00',
    description: 'count x price per bag x segments: a bag flies every segment.',
  })
  fee: string;
}

export class FlightBookingPassengerDto {
  @ApiProperty({ example: 'Khaled Elshitany' })
  fullName: string;

  @ApiProperty({ example: '2004-03-10' })
  dateOfBirth: string;

  @ApiProperty({ enum: PassengerType, example: PassengerType.ADULT })
  passengerType: PassengerType;

  @ApiProperty({
    example: '•••••5678',
    description:
      'Masked: only the last 4 characters are shown. The full number is personal data.',
  })
  documentNumber: string;

  @ApiProperty({
    example: '199.99',
    description: 'Over all segments; an infant pays 10% of each fare.',
  })
  fare: string;

  @ApiProperty({ type: FlightBookingExtraBagsDto, nullable: true })
  extraBags: FlightBookingExtraBagsDto | null;
}

export class FlightBookingCancellationTierDto {
  @ApiProperty({ example: 7 })
  daysBeforeDeparture: number;

  @ApiProperty({ example: 80 })
  refundPercentage: number;
}

// The outbound airline's terms when the booking was quoted or held (FLT-08, FLT-09).
export class FlightBookingPolicyDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  airlineId: string;

  @ApiProperty({
    example: 1,
    description: '0 when the airline had not defined a policy yet.',
  })
  version: number;

  @ApiProperty({
    example: '25.00',
    nullable: true,
    type: String,
    description: 'Price of one extra bag; null when the airline sells none.',
  })
  extraBagPrice: string | null;

  @ApiProperty({ example: 2, nullable: true, type: Number })
  maxExtraBagsPerPassenger: number | null;

  @ApiProperty({
    type: [FlightBookingCancellationTierDto],
    description:
      'Highest threshold first. Empty: a cancellation refunds 0% (FLT-09).',
  })
  cancellationTiers: FlightBookingCancellationTierDto[];
}

export class FlightBookingPriceDto {
  @ApiProperty({ example: '419.98', description: 'All fares.' })
  subtotal: string;

  @ApiProperty({ example: '0.00', description: 'All extra-bag fees.' })
  baggageTotal: string;

  @ApiProperty({ example: '419.98' })
  total: string;

  @ApiProperty({ example: 'USD' })
  currency: string;
}

// FLT-21: what the user checks before paying. POST /flight-bookings stores nothing.
export class FlightBookingSummaryDto {
  @ApiProperty({ enum: TripType, example: TripType.ONE_WAY })
  tripType: TripType;

  @ApiProperty({
    type: [FlightBookingSegmentDto],
    description: 'Outbound first.',
  })
  segments: FlightBookingSegmentDto[];

  @ApiProperty({ type: [FlightBookingPassengerDto] })
  passengers: FlightBookingPassengerDto[];

  @ApiProperty({ type: FlightBookingPolicyDto })
  policy: FlightBookingPolicyDto;

  @ApiProperty({ type: FlightBookingPriceDto })
  price: FlightBookingPriceDto;
}
