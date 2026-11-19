import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { HotelSearchDto } from '../../../hotel-search/dto/hotel-search.dto';

/**
 * GET /api/itineraries/:id/hotels (ITN-25). The hotel search query (HTL-11, HTL-12)
 * without the destination and the dates, which come from the chosen city group: the city
 * of the group, check-in on its first day and check-out the day after its last day.
 * guestCount, roomCount, the price and rating filters, sorting and paging are the same
 * fields, defaults and validation as GET /api/hotels/search (it extends
 * PaginationQueryDto through HotelSearchDto).
 */
export class ItineraryHotelSearchQueryDto extends OmitType(HotelSearchDto, [
  'cityId',
  'countryId',
  'checkInDate',
  'checkOutDate',
] as const) {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description:
      '1-based position of the city group in the cityGroups array of GET /api/itineraries/:id.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cityGroup!: number;
}
