import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaService } from './media.service';
import {
  MediaMetadata,
  MediaMetadataSchema,
} from './schemas/media-metadata.schema';

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
