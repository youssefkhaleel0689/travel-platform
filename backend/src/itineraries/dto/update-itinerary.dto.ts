import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Visibility } from '../schemas/itinerary.schema';
import { CreateItineraryDto } from './create-itinerary.dto';

export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {
  // Section 8.8 maps PATCH /api/itineraries/:id to ITN-01 and ITN-20, so the
  // visibility can be changed here as well as on PATCH /:id/visibility.
  @ApiPropertyOptional({ enum: Visibility, example: Visibility.PUBLIC })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;
}
