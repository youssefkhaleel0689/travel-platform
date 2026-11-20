import { ApiProperty } from '@nestjs/swagger';
import { IsDateOnly } from '../../common/validation/date-only.decorator';

export class AvailableRoomsQueryDto {
  @ApiProperty({ example: '2026-12-20' }) @IsDateOnly() checkInDate!: string;
  @ApiProperty({ example: '2026-12-23' }) @IsDateOnly() checkOutDate!: string;
}
