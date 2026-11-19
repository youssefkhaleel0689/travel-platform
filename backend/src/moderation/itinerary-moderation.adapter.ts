import { Injectable } from '@nestjs/common';
import type {
  ContentModerationPort,
  ModeratedContent,
  ModerationResult,
} from '../common/moderation/content-moderation.port';
import { ModerationState } from '../common/moderation/moderation-state';
import { PublicItinerariesService } from '../itineraries/public-itineraries.service';

/** Public itineraries (D1) as moderation content, through D1's own service. */
@Injectable()
export class ItineraryModerationAdapter implements ContentModerationPort {
  constructor(private readonly itineraries: PublicItinerariesService) {}

  findForModeration(id: string): Promise<ModeratedContent | null> {
    return this.itineraries.findForModeration(id);
  }

  moderate(
    id: string,
    to: ModerationState,
    actorId: string,
  ): Promise<ModerationResult | null> {
    return this.itineraries.moderate(id, to, actorId);
  }
}
