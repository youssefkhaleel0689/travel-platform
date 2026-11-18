import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaService } from './media.service';
import {
  MediaMetadata,
  MediaMetadataSchema,
} from './schemas/media-metadata.schema';

/**
 * GEN-08, owned by D2. The shared image-upload service: blog posts (BLG-10)
 * use it today; itinerary activities (ITN-12, D1) and airline logos (FLT-01,
 * A2) import this module and call MediaService the same way. It has no
 * controller: every image is uploaded and served through the route of the
 * resource it belongs to, which is where the access check lives.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaMetadata.name, schema: MediaMetadataSchema },
    ]),
  ],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
