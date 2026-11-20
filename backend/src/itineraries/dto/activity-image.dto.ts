import { ApiProperty } from '@nestjs/swagger';
import { IMAGE_MIME_TYPES } from '../../media/media.constants';
import { EXAMPLE_ACTIVITY_ID } from '../itinerary-api-docs';

export const EXAMPLE_IMAGE_ID = '6720f1c2a1b2c3d4e5f60770';

// ITN-12: one image of an activity, as listed on the activity and returned by
// the upload.
export class ActivityImageDto {
  @ApiProperty({ example: EXAMPLE_IMAGE_ID })
  id: string;

  @ApiProperty({
    example: `/api/activities/${EXAMPLE_ACTIVITY_ID}/images/${EXAMPLE_IMAGE_ID}`,
    description: 'Serves the image (GET), for whoever may see the itinerary',
  })
  url: string;

  @ApiProperty({ enum: IMAGE_MIME_TYPES, example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({ example: 245760 })
  sizeBytes: number;

  @ApiProperty({ example: '2026-11-19T10:15:00.000Z' })
  uploadedAt: Date;
}
