import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import {
  CurrentUser,
  OptionalUser,
} from '../common/auth/current-user.decorator';
import { Public } from '../common/auth/public.decorator';
import { forbidden, unauthenticated } from '../common/swagger/standard-errors';
import { ApiImageUpload } from '../media/api-image-upload.decorator';
import { IMAGE_MIME_TYPES } from '../media/media.constants';
import type { UploadedImage } from '../media/media.service';
import { ActivitiesService } from './activities.service';
import { ActivityImageDto, EXAMPLE_IMAGE_ID } from './dto/activity-image.dto';
import { ApiErrorResponse, EXAMPLE_ACTIVITY_ID } from './itinerary-api-docs';

const IMAGES = `/api/activities/${EXAMPLE_ACTIVITY_ID}/images`;
const IMAGE = `${IMAGES}/${EXAMPLE_IMAGE_ID}`;

const ACTIVITY_ID_PARAM = {
  name: 'id',
  description: 'Activity id',
  example: EXAMPLE_ACTIVITY_ID,
};
const IMAGE_ID_PARAM = {
  name: 'imageId',
  description: 'Image id',
  example: EXAMPLE_IMAGE_ID,
};

const ACTIVITY_NOT_FOUND = {
  code: 'ACTIVITY_NOT_FOUND',
  message: 'Activity not found',
};
const IMAGE_NOT_FOUND = { code: 'IMAGE_NOT_FOUND', message: 'Image not found' };

// ITN-12: images on an activity, under the shared upload rule (GEN-08). The
// routes are under /activities like the other activity routes (ITN-10).
@ApiTags('Itineraries - Activities')
@Controller('activities')
export class ActivityImagesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Post(':id/images')
  @ApiCookieAuth()
  @ApiImageUpload(IMAGES, 'activity')
  @ApiOperation({
    summary: 'Attach an image to one of your activities (ITN-12, GEN-08)',
    description:
      'Multipart, field "file": one JPG or PNG of at most 5 MB. An activity ' +
      'holds at most 5 images. The response has the URL that serves it.',
  })
  @ApiParam(ACTIVITY_ID_PARAM)
  @ApiCreatedResponse({ type: ActivityImageDto })
  @ApiErrorResponse(unauthenticated(IMAGES))
  @ApiErrorResponse(forbidden(IMAGES, { role: false, passwordChange: true }))
  @ApiErrorResponse({
    status: 404,
    description:
      'No such activity, or it is in another account’s itinerary (ACC-11)',
    examples: [{ ...ACTIVITY_NOT_FOUND, path: IMAGES }],
  })
  addImage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<ActivityImageDto> {
    return this.activities.addImage(user, id, file);
  }

  @Get(':id/images/:imageId')
  @Public()
  @ApiOperation({
    summary: 'Download an image of an activity (ITN-12, GEN-08)',
    description:
      'Served to the itinerary’s owner, and to anyone when the itinerary is ' +
      'public and not hidden by moderation.',
  })
  @ApiParam(ACTIVITY_ID_PARAM)
  @ApiParam(IMAGE_ID_PARAM)
  @ApiProduces(...IMAGE_MIME_TYPES)
  @ApiOkResponse({
    description: 'The image file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiErrorResponse({
    status: 404,
    description:
      'No such activity or image, or you may not see the itinerary (a private one answers the same)',
    examples: [
      { ...ACTIVITY_NOT_FOUND, path: IMAGE },
      { ...IMAGE_NOT_FOUND, path: IMAGE },
    ],
  })
  async getImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @OptionalUser() viewer: AuthenticatedUser | undefined,
  ): Promise<StreamableFile> {
    const image = await this.activities.openImage(viewer, id, imageId);
    return new StreamableFile(createReadStream(image.path), {
      type: image.mimeType,
      length: image.sizeBytes,
    });
  }

  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Remove an image from one of your activities (ITN-12)',
  })
  @ApiParam(ACTIVITY_ID_PARAM)
  @ApiParam(IMAGE_ID_PARAM)
  @ApiNoContentResponse({ description: 'The image and its file are gone' })
  @ApiErrorResponse(unauthenticated(IMAGE))
  @ApiErrorResponse(forbidden(IMAGE, { role: false, passwordChange: true }))
  @ApiErrorResponse({
    status: 404,
    description:
      'No such activity or image, or the activity is in another account’s itinerary',
    examples: [
      { ...ACTIVITY_NOT_FOUND, path: IMAGE },
      { ...IMAGE_NOT_FOUND, path: IMAGE },
    ],
  })
  async removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.activities.removeImage(user, id, imageId);
  }
}
