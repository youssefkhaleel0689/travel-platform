import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { AvailabilityStatus } from '../schemas/availability.schema';

export class CreateAvailabilityDto {
  @ApiProperty({ example: '2026-12-01', description: 'Inclusive start date' })
  @IsDateString() startDate!: string;

  @ApiProperty({ example: '2027-01-01', description: 'Exclusive end date (must be after startDate)' })
  @IsDateString() endDate!: string;

  @ApiProperty({ enum: AvailabilityStatus })
  @IsEnum(AvailabilityStatus) status!: AvailabilityStatus;
}

export class UpdateAvailabilityDto {
  @ApiProperty() @IsMongoId() availabilityId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ enum: AvailabilityStatus }) @IsOptional() @IsEnum(AvailabilityStatus) status?: AvailabilityStatus;
}

export class RoomStatusQueryDto {
  @ApiProperty({ example: '2026-12-01' }) @IsDateString() startDate!: string;
  @ApiProperty({ example: '2026-12-15', description: 'Exclusive end date' }) @IsDateString() endDate!: string;
}
