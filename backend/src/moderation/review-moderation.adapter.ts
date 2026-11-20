import { Injectable } from '@nestjs/common';
import type {
  ContentModerationPort,
  ModeratedContent,
  ModerationResult,
} from '../common/moderation/content-moderation.port';
import { ModerationState } from '../common/moderation/moderation-state';
import { ReviewsService } from '../reviews/reviews.service';

/** Hotel reviews (B2) as moderation content, through B2's own service. */
@Injectable()
export class ReviewModerationAdapter implements ContentModerationPort {
  constructor(private readonly reviews: ReviewsService) {}

  findForModeration(id: string): Promise<ModeratedContent | null> {
    return this.reviews.findForModeration(id);
  }

  moderate(
    id: string,
    to: ModerationState,
    actorId: string,
  ): Promise<ModerationResult | null> {
    return this.reviews.moderate(id, to, actorId);
  }
}
