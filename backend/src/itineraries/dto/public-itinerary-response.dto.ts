import { ApiProperty } from '@nestjs/swagger';
import { ItinerarySummaryDto } from './itinerary-response.dto';

export class PublicItinerarySummaryDto extends ItinerarySummaryDto {
  @ApiProperty({ example: '64b7f0c2a1b2c3d4e5f60718' })
  authorId: string;

  @ApiProperty({ example: ['london', 'paris'] })
  cities: string[];
}
