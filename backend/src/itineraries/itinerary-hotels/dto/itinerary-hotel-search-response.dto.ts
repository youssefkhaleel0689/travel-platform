import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/pagination/dto/page.dto';

// GET /api/itineraries/:id/hotels (ITN-25). GET /api/hotels/search has no response DTO,
// so the hotel row is described here, field for field what HotelSearchService returns.

/** The city group the search was made for, numbered as in GET /api/itineraries/:id. */
export class ItineraryHotelCityGroupDto {
  @ApiProperty({
    example: 1,
    description: 'The cityGroup asked for (1-based).',
  })
  index: number;

  @ApiProperty({
    example: 'cairo',
    description: 'Seeded city id of the group.',
  })
  city: string;

  @ApiProperty({ example: 1, description: 'Day number of its first day.' })
  fromDay: number;

  @ApiProperty({ example: 2, description: 'Day number of its last day.' })
  toDay: number;

  @ApiProperty({
    example: '2026-12-20',
    description: 'The date of its first day.',
  })
  checkInDate: string;

  @ApiProperty({
    example: '2026-12-22',
    description: 'The day after its last day.',
  })
  checkOutDate: string;
}

/** One hotel with enough free rooms for the whole stay (HTL-11). */
export class ItineraryHotelResultDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60788' })
  hotelId: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiPropertyOptional({ example: '1 Corniche El Nil' })
  address?: string;

  @ApiPropertyOptional({ example: 'cairo' })
  cityId?: string;

  @ApiPropertyOptional({ example: 'EG' })
  countryId?: string;

  @ApiPropertyOptional({ example: 4 })
  starClass?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: "The hotel's first photo, when it has one (GEN-08).",
  })
  photo?: Record<string, unknown>;

  @ApiProperty({ example: 4.5, nullable: true, type: Number })
  ratingAverage: number | null;

  @ApiProperty({ example: 12 })
  ratingCount: number;

  @ApiProperty({
    example: '120.00',
    description: 'Price per night of the cheapest qualifying room (USD).',
  })
  pricePerNight: string;

  @ApiProperty({ example: 3 })
  freeRoomCount: number;
}

export class ItineraryHotelSearchResponseDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  itineraryId: string;

  @ApiProperty({ type: ItineraryHotelCityGroupDto })
  cityGroup: ItineraryHotelCityGroupDto;

  @ApiProperty({
    example: '2026-12-20T00:00:00.000Z',
    description: 'Check-in as hotel search echoes it (UTC midnight).',
  })
  checkInDate: string;

  @ApiProperty({ example: '2026-12-22T00:00:00.000Z' })
  checkOutDate: string;

  @ApiProperty({ example: 2 })
  nights: number;

  @ApiProperty({ example: 2 })
  guestCount: number;

  @ApiProperty({ example: 1 })
  roomCount: number;

  @ApiProperty({ type: [ItineraryHotelResultDto] })
  items: ItineraryHotelResultDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
