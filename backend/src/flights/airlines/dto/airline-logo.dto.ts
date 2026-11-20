import { ApiProperty } from '@nestjs/swagger';
import { IMAGE_MIME_TYPES } from '../../../media/media.constants';

// FLT-01 / GEN-08: the one logo of an airline, as returned by the upload. The same URL
// is stored in airline.logo.
export class AirlineLogoDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60770' })
  id: string;

  @ApiProperty({
    example: '/api/airlines/6720f1c2a1b2c3d4e5f60718/logo',
    description: 'Serves the logo (GET, public for an ACTIVE airline)',
  })
  url: string;

  @ApiProperty({ enum: IMAGE_MIME_TYPES, example: 'image/png' })
  mimeType: string;

  @ApiProperty({ example: 24576 })
  sizeBytes: number;

  @ApiProperty({ example: '2026-11-20T10:15:00.000Z' })
  uploadedAt: Date;
}
