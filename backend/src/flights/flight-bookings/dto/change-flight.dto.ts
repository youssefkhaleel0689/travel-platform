import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

/** FLT-27: change one segment of a confirmed flight booking. */
export class ChangeFlightDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  newFlightId: string;

  @ApiPropertyOptional({ example: 0, description: 'Segment index, starting at 0' })
  @IsOptional()
  @IsInt()
  @Min(0)
  segmentIndex?: number;
}
