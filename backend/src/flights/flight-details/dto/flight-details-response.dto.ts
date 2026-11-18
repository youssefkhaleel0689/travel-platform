import { ApiProperty } from '@nestjs/swagger';
import { AirportDto } from '../../../common/reference-data/dto/airport.dto';
import { CabinCategory, FlightStatus } from '../../schemas/flight.schema';
import { FlightSearchAirlineDto } from '../../flight-search/dto/flight-search-response.dto';

// One cabin on the details page (FLT-17). Money is a decimal string (Decimal128).
export class FlightDetailsCabinDto {
  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  category: CabinCategory;

  @ApiProperty({
    example: '199.99',
    description: 'Price per seat in USD, as a decimal string.',
  })
  pricePerSeat: string;

  @ApiProperty({
    example: 42,
    description:
      'Seats that can still be booked: total minus booked minus held.',
  })
  seatsRemaining: number;

  @ApiProperty({ example: 1, description: 'Bags included in the fare.' })
  freeBaggageCount: number;

  @ApiProperty({ example: 23, description: 'Maximum weight of one bag.' })
  maxBagWeightKg: number;
}

export class FlightDetailsCancellationTierDto {
  @ApiProperty({
    example: 7,
    description:
      'Applies when cancelling at least this many days before departure.',
  })
  daysBeforeDeparture: number;

  @ApiProperty({
    example: 80,
    description: 'Percentage of the price refunded.',
  })
  refundPercentage: number;
}

// The airline's terms (FLT-08, FLT-09). An airline without a policy sells no extra bags
// and refunds nothing on cancellation.
export class FlightDetailsPolicyDto {
  @ApiProperty({
    example: '15.00',
    nullable: true,
    type: String,
    description:
      'Price of one extra bag in USD; null when the airline sells none.',
  })
  extraBagPrice: string | null;

  @ApiProperty({
    example: 2,
    nullable: true,
    type: Number,
    description:
      'Extra bags one passenger can buy; null when the airline sells none.',
  })
  maxExtraBagsPerPassenger: number | null;

  @ApiProperty({
    type: [FlightDetailsCancellationTierDto],
    description:
      'From the most days before departure to the fewest. Empty: no refund on cancellation.',
  })
  cancellationTiers: FlightDetailsCancellationTierDto[];
}

// GET /api/flights/:id (FLT-17).
export class FlightDetailsDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({
    enum: FlightStatus,
    example: FlightStatus.SCHEDULED,
    description: 'Only a SCHEDULED flight that has not departed can be booked.',
  })
  status: FlightStatus;

  @ApiProperty({ type: FlightSearchAirlineDto })
  airline: FlightSearchAirlineDto;

  @ApiProperty({ example: 'MS777' })
  flightNumber: string;

  @ApiProperty({ type: AirportDto })
  departureAirport: AirportDto;

  @ApiProperty({ type: AirportDto })
  arrivalAirport: AirportDto;

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

  @ApiProperty({
    example: 240,
    description: 'Computed from the two UTC instants, never stored.',
  })
  durationMinutes: number;

  @ApiProperty({ type: [FlightDetailsCabinDto] })
  cabins: FlightDetailsCabinDto[];

  @ApiProperty({ type: FlightDetailsPolicyDto })
  policy: FlightDetailsPolicyDto;
}
