import { ForbiddenException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { AirlineModeratorAssignment } from './schemas/airline-moderator-assignment.schema';

/**
 * The airline a moderator is assigned to (ACC-11). The link lives only in
 * airlineModeratorAssignment and is read on every request; the client never says which
 * airline it acts for. No assignment means 403: a moderator without an airline manages
 * nothing. Used by the flight and cabin services (FLT-03, FLT-04).
 */
export async function assignedAirlineId(
  assignmentModel: Model<AirlineModeratorAssignment>,
  actor: AuthenticatedUser,
): Promise<Types.ObjectId> {
  const assignment = await assignmentModel
    .findOne({ moderatorId: new Types.ObjectId(actor.userId) })
    .lean<AirlineModeratorAssignment>()
    .exec();
  if (!assignment) {
    throw new ForbiddenException({
      code: 'NO_AIRLINE_ASSIGNED',
      message: 'You are not assigned to an airline',
    });
  }
  return assignment.airlineId;
}
