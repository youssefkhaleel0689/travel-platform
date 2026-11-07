import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class AvailableRoomsQueryDto {
  @ApiProperty({ example: '2026-12-20' }) @IsDateString() checkInDate!: string;
  @ApiProperty({ example: '2026-12-23' }) @IsDateString() checkOutDate!: string;
}
