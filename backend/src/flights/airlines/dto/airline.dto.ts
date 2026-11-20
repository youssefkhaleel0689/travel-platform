import { ApiProperty } from '@nestjs/swagger';
import { AirlineStatus } from '../../schemas/airline.schema';

// Response shape of the airline endpoints (FLT-01).
export class AirlineDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'EgyptAir' })
  name: string;

  @ApiProperty({ example: 'MS' })
  iataCode: string;

  @ApiProperty({ example: 'MSR', nullable: true, type: String })
  icaoCode: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Logo URL; null until a logo is uploaded (GEN-08).',
  })
  logo: string | null;

  @ApiProperty({ enum: AirlineStatus, example: AirlineStatus.ACTIVE })
  status: AirlineStatus;

  @ApiProperty({ example: '2026-11-09T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-09T10:00:00.000Z' })
  updatedAt: string;
}
