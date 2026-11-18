import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import {
  Itinerary,
  ItineraryDay,
  ItineraryDocument,
} from './schemas/itinerary.schema';

// Finds the itinerary that belongs to this user AND contains a child
// (activity, budget entry, transport cost) with the given id.
// Someone else's data is reported as 404, so its existence is not leaked.
export async function findOwnedByChildOrThrow(
  model: Model<Itinerary>,
  userId: string,
  path: string,
  childId: string,
  notFoundMessage: string,
): Promise<ItineraryDocument> {
  if (!Types.ObjectId.isValid(userId)) {
    throw new UnauthorizedException('Not authenticated');
  }
  if (!Types.ObjectId.isValid(childId)) {
    throw new BadRequestException({
      code: 'INVALID_VALUE',
      message: 'Invalid id',
    });
  }
  const doc = await model.findOne({
    owner: new Types.ObjectId(userId),
    [path]: new Types.ObjectId(childId),
  });
  if (!doc) {
    throw new NotFoundException(notFoundMessage);
  }
  return doc;
}

export function findDayOrThrow(
  doc: ItineraryDocument,
  dayId: string,
): ItineraryDay {
  if (!Types.ObjectId.isValid(dayId)) {
    throw new BadRequestException({
      code: 'INVALID_VALUE',
      message: 'Invalid day id',
    });
  }
  const oid = new Types.ObjectId(dayId);
  const day = doc.days.find((d) => d._id.equals(oid));
  if (!day) {
    throw new NotFoundException('Day not found');
  }
  return day;
}
