import { ApiProperty } from '@nestjs/swagger';
import { FlightSearchPageDto } from '../../flight-search/dto/flight-search-response.dto';

// GET /api/itineraries/:id/flights (ITN-26): the search response, plus where and when
// the itinerary made it search.
export class ItineraryFlightSearchResponseDto {
  @ApiProperty({
    example: 'dubai',
    description: "The city of the itinerary's first day.",
  })
  destinationCityId: string;

  @ApiProperty({
    example: ['DXB'],
    description:
      'Every seeded airport of that city: the outbound flights land at any of them.',
  })
  destinationAirportIds: string[];

  @ApiProperty({
    example: '2026-12-20',
    description:
      "The outbound date used: the one asked for, or the itinerary's start date.",
  })
  departureDate: string;

  @ApiProperty({
    example: '2026-12-27',
    nullable: true,
    type: String,
    description:
      "The return date used for a ROUND_TRIP: the one asked for, or the itinerary's last day. Null one way.",
  })
  returnDate: string | null;

  @ApiProperty({
    type: FlightSearchPageDto,
    description: 'From the origin airport to any airport of the city.',
  })
  outbound: FlightSearchPageDto;

  @ApiProperty({
    type: FlightSearchPageDto,
    nullable: true,
    description:
      'Only for a ROUND_TRIP: from any airport of the city back to the origin airport.',
  })
  inbound: FlightSearchPageDto | null;
}
