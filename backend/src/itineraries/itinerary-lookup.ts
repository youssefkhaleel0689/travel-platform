import { NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ownerFilter } from '../common/auth/ownership';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import {
  Itinerary,
  ItineraryDay,
  ItineraryDocument,
  NOT_DELETED,
} from './schemas/itinerary.schema';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export interface NotFoundError {
  code: string;
  message: string;
}

export const DAY_NOT_FOUND: NotFoundError = {
  code: 'DAY_NOT_FOUND',
  message: 'Day not found',
};

// Finds the itinerary that belongs to this user AND contains a child
// (activity, budget entry, transport cost) with the given id (ACC-11).
// A malformed id, a missing child and someone else's child all give the same
// 404, so ids cannot be probed. The owner is part of the database filter.
export async function findOwnedByChildOrThrow(
  model: Model<Itinerary>,
  user: AuthenticatedUser,
  path: string,
  childId: string,
  notFound: NotFoundError,
): Promise<ItineraryDocument> {
  if (!OBJECT_ID.test(childId)) {
    throw new NotFoundException(notFound);
  }
  const doc = await model
    .findOne({
      ...ownerFilter(user),
      ...NOT_DELETED,
      [path]: new Types.ObjectId(childId),
    })
    .exec();
  if (!doc) {
    throw new NotFoundException(notFound);
  }
  return doc;
}

export function findDayOrThrow(
  doc: ItineraryDocument,
  dayId: string,
): ItineraryDay {
  if (!OBJECT_ID.test(dayId)) {
    throw new NotFoundException(DAY_NOT_FOUND);
  }
  const oid = new Types.ObjectId(dayId);
  const day = doc.days.find((d) => d._id.equals(oid));
  if (!day) {
    throw new NotFoundException(DAY_NOT_FOUND);
  }
  return day;
}
