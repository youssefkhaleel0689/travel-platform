import {
  Inject,
  Injectable,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import {
  COMMENT_MODERATION_PORT,
  ContentType,
  ITINERARY_MODERATION_PORT,
  POST_MODERATION_PORT,
  REVIEW_MODERATION_PORT,
} from '../common/moderation/content-moderation.port';
// Types only: a type in a decorated constructor signature has to be imported
// this way while isolatedModules and emitDecoratorMetadata are both on.
import type {
  ContentModerationPort,
  ModeratedContent,
  ModerationResult,
} from '../common/moderation/content-moderation.port';
import { ModerationState } from '../common/moderation/moderation-state';

/**
 * Routes a content type to the module that owns it, like BookingsGateway.
 * Posts, comments and reviews are always wired; itineraries come with D1, and
 * until then answer 501 CONTENT_TYPE_UNAVAILABLE rather than a 500.
 */
@Injectable()
export class ContentModerationGateway {
  constructor(
    @Inject(POST_MODERATION_PORT) private readonly posts: ContentModerationPort,
    @Inject(COMMENT_MODERATION_PORT)
    private readonly comments: ContentModerationPort,
    @Inject(REVIEW_MODERATION_PORT)
    private readonly reviews: ContentModerationPort,
    @Optional()
    @Inject(ITINERARY_MODERATION_PORT)
    private readonly itineraries?: ContentModerationPort,
  ) {}

  find(type: ContentType, id: string): Promise<ModeratedContent | null> {
    return this.port(type).findForModeration(id);
  }

  moderate(
    type: ContentType,
    id: string,
    to: ModerationState,
    actorId: string,
  ): Promise<ModerationResult | null> {
    return this.port(type).moderate(id, to, actorId);
  }

  private port(type: ContentType): ContentModerationPort {
    const port = {
      [ContentType.POST]: this.posts,
      [ContentType.COMMENT]: this.comments,
      [ContentType.REVIEW]: this.reviews,
      [ContentType.ITINERARY]: this.itineraries,
    }[type];
    if (!port) {
      throw new NotImplementedException({
        code: 'CONTENT_TYPE_UNAVAILABLE',
        message:
          `${type} moderation is not available yet: the module that owns ` +
          'it has not been connected',
      });
    }
    return port;
  }
}
