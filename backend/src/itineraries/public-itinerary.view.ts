import { Itinerary } from './schemas/itinerary.schema';
import { toItinerarySummary } from './itinerary.view';

type PublicSummaryLike = Pick<
  Itinerary,
  | '_id'
  | 'userId'
  | 'title'
  | 'countries'
  | 'startDate'
  | 'visibility'
  | 'updatedAt'
> & { days: { city: string }[] };

// authorId is the owner's user id. Show the author's name once the users
// module exists.
export function toPublicSummary(doc: PublicSummaryLike) {
  return {
    ...toItinerarySummary(doc),
    authorId: doc.userId.toString(),
    cities: [...new Set(doc.days.map((d) => d.city))],
  };
}
