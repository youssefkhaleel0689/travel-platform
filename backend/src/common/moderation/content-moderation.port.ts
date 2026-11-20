import { ConflictException } from '@nestjs/common';
import type { ClientSession, Model } from 'mongoose';
import { Types } from 'mongoose';
import { ModerationState } from './moderation-state';

// Posts, comments, reviews and itineraries live in three modules. Each owner
// implements this port so moderation never touches their collections
// (same pattern as BookingsPort).
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
  /** The author, who may not report it. */
  ownerId: string;
  moderationState: ModerationState;
  /** Only content everyone can see may be reported. */
  reportable: boolean;
  /** Short text for the admin list, e.g. the post title. */
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

  /** Null when it does not exist; 409 for a change that is not allowed. */
  moderate(
    id: string,
    to: ModerationState,
    actorId: string,
  ): Promise<ModerationResult | null>;
}

export const POST_MODERATION_PORT = 'POST_MODERATION_PORT';
export const COMMENT_MODERATION_PORT = 'COMMENT_MODERATION_PORT';
export const REVIEW_MODERATION_PORT = 'REVIEW_MODERATION_PORT';
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

// Shared by every owner. The update filters on the state it read, so two
// admins acting at once get 409 MODERATION_CONFLICT. Delete is soft: the row
// stays so reports and the audit log still point at it.
export async function applyModeration<T extends Partial<WithModerationState>>(
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
