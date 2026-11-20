import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SeatAssignmentInputDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  passengerId: string;

  @ApiProperty({ example: '12A', pattern: '^[1-9][0-9]*[A-F]$' })
  @Matches(/^[1-9]\d*[A-F]$/, {
    message: 'seatNumber must look like 12A (row 1.., letter A..F)',
  })
  seatNumber: string;
}

/** FLT-28: choose seats for one segment of a confirmed booking. */
export class SelectSeatsDto {
  @ApiPropertyOptional({ example: 0, description: 'Segment index: 0 outbound, 1 return' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  segmentIndex?: number;

  @ApiProperty({ type: [SeatAssignmentInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SeatAssignmentInputDto)
  assignments: SeatAssignmentInputDto[];
}
