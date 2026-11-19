import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/pagination/dto/page.dto';

// ITN-25: the chosen city group and the stay it gives.
export class ItineraryCityGroupStayDto {
  @ApiProperty({ example: 1 })
  group: number;

  @ApiProperty({ example: 'paris' })
  city: string;

  @ApiProperty({ example: 1 })
  fromDay: number;

  @ApiProperty({ example: 3 })
  toDay: number;

  @ApiProperty({
    example: '2026-12-20',
    description: "Check-in: the date of the group's first day",
  })
  checkInDate: string;

  @ApiProperty({
    example: '2026-12-23',
    description: "Check-out: the day after the group's last day",
  })
  checkOutDate: string;
}

// One hotel as hotel search (HTL-11) returns it.
export class ItineraryHotelResultDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f607a0' })
  hotelId: string;

  @ApiProperty({ example: 'Hotel Lumière' })
  name: string;

  @ApiProperty({ required: false, example: '12 Rue de Rivoli' })
  address?: string;

  @ApiProperty({ required: false, example: 'paris' })
  cityId?: string;

  @ApiProperty({ required: false, example: 'FR' })
  countryId?: string;

  @ApiProperty({ required: false, example: 4 })
  starClass?: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 4.5,
    description: 'Null when the hotel has no reviews yet',
  })
  ratingAverage: number | null;

  @ApiProperty({ example: 12 })
  ratingCount: number;

  @ApiProperty({
    example: '120.00',
    description:
      'Cheapest qualifying room, per night, in the platform currency',
  })
  pricePerNight: string;

  @ApiProperty({ example: 3 })
  freeRoomCount: number;
}

export class ItineraryHotelSearchResponseDto {
  @ApiProperty({ type: ItineraryCityGroupStayDto })
  cityGroup: ItineraryCityGroupStayDto;

  @ApiProperty({ example: 3 })
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
