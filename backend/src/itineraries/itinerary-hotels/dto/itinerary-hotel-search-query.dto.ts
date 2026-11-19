import { ApiProperty, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { HotelSearchDto } from '../../../hotel-search/dto/hotel-search.dto';
import { MAX_DAYS } from '../../itinerary-days.logic';

/**
 * GET /api/itineraries/:id/hotels (ITN-25). The hotel search query (HTL-11,
 * HTL-12) without destination and dates, which come from the chosen city group,
 * plus that group's number. The picked fields keep the hotel search's own rules
 * and defaults, so both searches validate the same way.
 */
export class ItineraryHotelSearchQueryDto extends PickType(HotelSearchDto, [
  'guestCount',
  'roomCount',
  'minPricePerNight',
  'maxPricePerNight',
  'minAverageRating',
  'sortBy',
  'sortOrder',
  'page',
] as const) {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description:
      'Which city group (1 = the first), in the order of cityGroups on the itinerary (ITN-09)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  group: number;
}
