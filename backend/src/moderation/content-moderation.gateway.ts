import { Inject, Injectable } from '@nestjs/common';
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

/** Routes a content type to the module that owns it, like BookingsGateway. */
@Injectable()
export class ContentModerationGateway {
  constructor(
    @Inject(POST_MODERATION_PORT) private readonly posts: ContentModerationPort,
    @Inject(COMMENT_MODERATION_PORT)
    private readonly comments: ContentModerationPort,
    @Inject(REVIEW_MODERATION_PORT)
    private readonly reviews: ContentModerationPort,
    @Inject(ITINERARY_MODERATION_PORT)
    private readonly itineraries: ContentModerationPort,
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
    return {
      [ContentType.POST]: this.posts,
      [ContentType.COMMENT]: this.comments,
      [ContentType.REVIEW]: this.reviews,
      [ContentType.ITINERARY]: this.itineraries,
    }[type];
  }
}
