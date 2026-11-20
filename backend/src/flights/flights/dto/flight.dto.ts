import { ApiProperty } from '@nestjs/swagger';
import { CabinCategory, FlightStatus } from '../../schemas/flight.schema';

// One cabin of a flight (FLT-04). Money is a string so no precision is lost (Decimal128).
export class CabinInventoryDto {
  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  category: CabinCategory;

  @ApiProperty({ example: 150 })
  totalSeats: number;

  @ApiProperty({ example: 0 })
  bookedSeats: number;

  @ApiProperty({ example: 0 })
  heldSeats: number;

  @ApiProperty({
    example: '199.99',
    description: 'Price per seat in USD, as a decimal string.',
  })
  price: string;

  @ApiProperty({ example: 1 })
  freeBaggageCount: number;

  @ApiProperty({ example: 23 })
  maxBagWeightKg: number;
}

// Response shape of the flight endpoints (FLT-03).
export class FlightDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: '6af1561d0ee83eb5be8d1f25' })
  airlineId: string;

  @ApiProperty({ example: 'MS777' })
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  departureAirportId: string;

  @ApiProperty({ example: 'DXB' })
  arrivalAirportId: string;

  @ApiProperty({
    example: '2026-12-20T08:30',
    description:
      'What the moderator entered: local time at the departure airport.',
  })
  departureLocalInput: string;

  @ApiProperty({
    example: '2026-12-20T14:30',
    description:
      'What the moderator entered: local time at the arrival airport.',
  })
  arrivalLocalInput: string;

  @ApiProperty({ example: '2026-12-20T06:30:00.000Z' })
  departureAtUtc: string;

  @ApiProperty({ example: '2026-12-20T10:30:00.000Z' })
  arrivalAtUtc: string;

  @ApiProperty({
    example: '2026-12-20',
    description: 'Calendar date at the departure airport (YYYY-MM-DD).',
  })
  departureDateKey: string;

  @ApiProperty({
    example: 240,
    description: 'Computed from the two UTC instants, never stored.',
  })
  durationMinutes: number;

  @ApiProperty({ enum: FlightStatus, example: FlightStatus.SCHEDULED })
  status: FlightStatus;

  @ApiProperty({
    type: [CabinInventoryDto],
    description: 'Empty until cabins are defined (FLT-04).',
  })
  cabinInventory: CabinInventoryDto[];

  @ApiProperty({ example: '2026-11-12T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-12T10:00:00.000Z' })
  updatedAt: string;
}
