import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Visibility } from '../schemas/itinerary.schema';

export class SetVisibilityDto {
  @ApiProperty({ enum: Visibility, example: Visibility.PUBLIC })
  @IsEnum(Visibility)
  visibility: Visibility;
}
