import { Logger } from '@nestjs/common';
import { MediaTargetType } from '../media/media.constants';
import { MediaService } from '../media/media.service';

const logger = new Logger('ActivityImagesCleanup');

/**
 * ITN-12: removes the stored images of activities that no longer exist (an
 * activity, a day or a whole itinerary was deleted). Runs after the itinerary
 * is saved, so a failure here never undoes the user's delete: it is logged and
 * the files are left behind instead.
 */
export async function removeActivityImages(
  media: MediaService,
  activityIds: string[],
): Promise<void> {
  await Promise.all(
    activityIds.map(async (activityId) => {
      try {
        await media.removeAllForTarget(MediaTargetType.ACTIVITY, activityId);
      } catch (error) {
        logger.warn(
          `Could not remove the images of activity ${activityId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
}
