import type { PageDto } from '../pagination/dto/page.dto';

/**
 * BLG-12 needs an author's public itineraries (ITN-20), which belong to the
 * itineraries module (D1). The blog never reads that collection: it asks
 * through this port, the same way payments asks for bookings through
 * BookingsPort (GEN-11).
 *
 * To plug it in (D1): implement PublicItinerariesPort in one class, provide it
 * under PUBLIC_ITINERARIES_PORT from a @Global() module and export the token.
 * Until then the author page answers with `publicItineraries: null` and
 * `itinerariesAvailable: false` instead of failing.
 *
 * ```ts
 * @Global()
 * @Module({
 *   providers: [
 *     PublicItinerariesAdapter,
 *     { provide: PUBLIC_ITINERARIES_PORT, useExisting: PublicItinerariesAdapter },
 *   ],
 *   exports: [PUBLIC_ITINERARIES_PORT],
 * })
 * export class ItinerariesModule {}
 * ```
 */
export interface PublicItinerarySummary {
  id: string;
  title: string;
  /** Free-form extra fields D1 wants to show (destination, number of days...). */
  [field: string]: unknown;
}

export interface PublicItinerariesPort {
  /**
   * One page (10, GEN-05) of the author's itineraries that are PUBLIC and
   * VISIBLE (ITN-20, GEN-10), newest first. Never private or hidden ones.
   */
  listPublicByAuthor(
    authorId: string,
    page: number,
  ): Promise<PageDto<PublicItinerarySummary>>;
}

export const PUBLIC_ITINERARIES_PORT = 'PUBLIC_ITINERARIES_PORT';
