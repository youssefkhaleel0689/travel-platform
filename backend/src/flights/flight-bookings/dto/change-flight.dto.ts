import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';

/** FLT-27: change one segment of a confirmed flight booking. */
export class ChangeFlightDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  newFlightId: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Segment index: 0 outbound, 1 return',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  segmentIndex?: number;
}
