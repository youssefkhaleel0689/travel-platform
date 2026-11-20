import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/pagination/dto/page.dto';
import { CabinCategory } from '../../schemas/flight.schema';

export class FlightSearchAirlineDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'EgyptAir' })
  name: string;

  @ApiProperty({ example: 'MS' })
  iataCode: string;
}

// A cabin with enough free seats for the whole party, in the price range (FLT-11, FLT-15).
export class FlightSearchCabinDto {
  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  category: CabinCategory;

  @ApiProperty({
    example: '199.99',
    description:
      'Fare per adult or child in USD, as a decimal string. An infant pays 10% of it (FLT-12).',
  })
  pricePerSeat: string;

  @ApiProperty({ example: 42, description: 'total - booked - held.' })
  seatsAvailable: number;

  @ApiProperty({ example: 1 })
  freeBaggageCount: number;

  @ApiProperty({ example: 23 })
  maxBagWeightKg: number;
}

// One flight in the search results.
export class FlightSearchItemDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60719' })
  id: string;

  @ApiProperty({ type: FlightSearchAirlineDto })
  airline: FlightSearchAirlineDto;

  @ApiProperty({ example: 'MS777' })
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

  @ApiProperty({
    example: 240,
    description: 'Computed from the two UTC instants, never stored.',
  })
  durationMinutes: number;

  @ApiProperty({
    example: '199.99',
    description:
      'The cheapest pricePerSeat in cabins. sortBy=price sorts by it (FLT-15).',
  })
  lowestPrice: string;

  @ApiProperty({
    type: [FlightSearchCabinDto],
    description: 'Only the cabins that match the search. Never empty.',
  })
  cabins: FlightSearchCabinDto[];
}

// PageDto<FlightSearchItemDto> spelled out, because Swagger cannot read a generic class.
export class FlightSearchPageDto {
  @ApiProperty({ type: [FlightSearchItemDto] })
  items: FlightSearchItemDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

// Response of GET /flights/search (FLT-11, FLT-12).
export class FlightSearchResponseDto {
  @ApiProperty({
    type: FlightSearchPageDto,
    description:
      'Flights from departureAirportId to arrivalAirportId on departureDate, page `page`. ' +
      'No items means no flights were found.',
  })
  outbound: FlightSearchPageDto;

  @ApiProperty({
    type: FlightSearchPageDto,
    nullable: true,
    description:
      'ROUND_TRIP only: flights back from arrivalAirportId on returnDate, page `returnPage`. ' +
      'null for ONE_WAY.',
  })
  inbound: FlightSearchPageDto | null;
}
