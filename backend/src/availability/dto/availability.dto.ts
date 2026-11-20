import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { IsDateOnly } from '../../common/validation/date-only.decorator';
import { AvailabilityStatus } from '../schemas/availability.schema';

export class CreateAvailabilityDto {
  @ApiProperty({ example: '2026-12-01', description: 'Inclusive start date' })
  @IsDateOnly()
  startDate!: string;

  @ApiProperty({
    example: '2027-01-01',
    description: 'Exclusive end date (must be after startDate)',
  })
  @IsDateOnly()
  endDate!: string;

  @ApiProperty({ enum: AvailabilityStatus })
  @IsEnum(AvailabilityStatus)
  status!: AvailabilityStatus;
}

export class UpdateAvailabilityDto {
  @ApiProperty() @IsMongoId() availabilityId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateOnly() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateOnly() endDate?: string;
  @ApiPropertyOptional({ enum: AvailabilityStatus })
  @IsOptional()
  @IsEnum(AvailabilityStatus)
  status?: AvailabilityStatus;
}

export class RoomStatusQueryDto {
  @ApiProperty({ example: '2026-12-01' }) @IsDateOnly() startDate!: string;
  @ApiProperty({ example: '2026-12-15', description: 'Exclusive end date' })
  @IsDateOnly()
  endDate!: string;
}
