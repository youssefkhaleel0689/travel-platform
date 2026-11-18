import { ConflictException } from '@nestjs/common';
import type { ClientSession, Model } from 'mongoose';
import { Types } from 'mongoose';
import { ModerationState } from './moderation-state';

/**
 * GEN-09 and GEN-10 cover posts, comments, reviews and itineraries, which
 * belong to three modules (blog D2, reviews B2, itineraries D1). Moderation
 * never reads or writes those collections: each owner implements this port,
 * the same pattern as BookingsPort (GEN-11).
 */
export enum ContentType {
  POST = 'POST',
  COMMENT = 'COMMENT',
  REVIEW = 'REVIEW',
  ITINERARY = 'ITINERARY',
}

export const CONTENT_TYPES = Object.values(ContentType);

/** What moderation needs to know about one piece of content. */
export interface ModeratedContent {
  id: string;
  /** Its author: nobody may report their own content. */
  ownerId: string;
  moderationState: ModerationState;
  /**
   * Whether a user may report it right now: only content everyone can see
   * (a published post, a visible comment on one, a visible review, a public
   * itinerary). Reporting a draft would reveal that it exists.
   */
  reportable: boolean;
  /** A short text for the admin's report list, e.g. the post title. */
  preview: string;
}

export interface ModerationResult {
  before: ModerationState;
  after: ModerationState;
  /** False when it already was in the requested state (nothing written). */
  changed: boolean;
}

export interface ContentModerationPort {
  /** The content in any state, or null when it does not exist. */
  findForModeration(id: string): Promise<ModeratedContent | null>;

  /**
   * Moves the content to `to` and keeps whatever depends on visibility in
   * step (comment counts, hotel ratings). Null when it does not exist;
   * 409 when the change is not allowed (a deleted item cannot be restored).
   * Use applyModeration() below for the state change itself.
   */
  moderate(
    id: string,
    to: ModerationState,
    actorId: string,
  ): Promise<ModerationResult | null>;
}

export const POST_MODERATION_PORT = 'POST_MODERATION_PORT';
export const COMMENT_MODERATION_PORT = 'COMMENT_MODERATION_PORT';
export const REVIEW_MODERATION_PORT = 'REVIEW_MODERATION_PORT';
/**
 * Provided by D1 from a @Global() module, like the booking ports. Until then
 * itinerary reports and actions answer 501 CONTENT_TYPE_UNAVAILABLE.
 */
export const ITINERARY_MODERATION_PORT = 'ITINERARY_MODERATION_PORT';

/** Which states each target state may be reached from (GEN-10). */
const ALLOWED_FROM: Readonly<Record<ModerationState, ModerationState[]>> = {
  [ModerationState.HIDDEN]: [ModerationState.VISIBLE],
  [ModerationState.VISIBLE]: [ModerationState.HIDDEN],
  [ModerationState.DELETED]: [ModerationState.VISIBLE, ModerationState.HIDDEN],
};

/** The moderation fields (schema section 3) to set for a new state. */
export function moderationFields(
  to: ModerationState,
  actorId: string,
): Record<string, unknown> {
  const actor = new Types.ObjectId(actorId);
  switch (to) {
    case ModerationState.HIDDEN:
      return { moderationState: to, hiddenAt: new Date(), hiddenBy: actor };
    case ModerationState.DELETED:
      return { moderationState: to, deletedAt: new Date(), deletedBy: actor };
    case ModerationState.VISIBLE:
      return { moderationState: to, hiddenAt: null, hiddenBy: null };
  }
}

interface WithModerationState {
  moderationState: ModerationState;
}

/**
 * The state change every owner shares, so the transitions cannot drift
 * between modules. Reads the current state, then writes with that state in
 * the filter: if another admin changed it in between, nothing is written and
 * the caller gets 409 MODERATION_CONFLICT instead of a lost update.
 *
 * Deleting is a soft delete (moderationState DELETED): the row stays, so the
 * audit log and the reports keep pointing at something an admin can inspect.
 */
export async function applyModeration<T extends WithModerationState>(
  model: Model<T>,
  id: string,
  to: ModerationState,
  actorId: string,
  session?: ClientSession,
): Promise<ModerationResult | null> {
  if (!/^[0-9a-f]{24}$/i.test(id)) {
    return null;
  }
  const current = await model
    .findById(id)
    .select('moderationState')
    .session(session ?? null)
    .lean<WithModerationState>()
    .exec();
  if (!current) {
    return null;
  }
  const before = current.moderationState;
  if (before === to) {
    return { before, after: to, changed: false };
  }
  if (!ALLOWED_FROM[to].includes(before)) {
    throw new ConflictException({
      code: 'INVALID_MODERATION_CHANGE',
      message: `Content that is ${before} cannot be made ${to}`,
    });
  }
  const result = await model
    .updateOne(
      { _id: new Types.ObjectId(id), moderationState: before } as never,
      { $set: moderationFields(to, actorId) } as never,
      { session },
    )
    .exec();
  if (result.matchedCount === 0) {
    throw new ConflictException({
      code: 'MODERATION_CONFLICT',
      message: 'The content changed at the same time; try again',
    });
  }
  return { before, after: to, changed: true };
}
