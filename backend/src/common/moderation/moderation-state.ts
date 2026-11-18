// Schema section 3, "moderation fields": every piece of user content that can
// be reported (posts, comments, reviews, itineraries) carries this state.
// VISIBLE is the default. HIDDEN content is visible only to its author and to
// admins; DELETED content is visible to admins only. Only VISIBLE content
// appears in public lists, search and rating aggregates (GEN-10).
//
// The values are the same strings as ReviewModerationState in the reviews
// module, so the two enums are interchangeable at the database level.
export enum ModerationState {
  VISIBLE = 'VISIBLE',
  HIDDEN = 'HIDDEN',
  DELETED = 'DELETED',
}

export const MODERATION_STATES = Object.values(ModerationState);
