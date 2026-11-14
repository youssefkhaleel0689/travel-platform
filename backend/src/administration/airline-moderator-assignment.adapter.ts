import { BadRequestException, Injectable } from '@nestjs/common';
import { AirlinesService } from '../flights/airlines/airlines.service';
import { AirlineStatus } from '../flights/schemas/airline.schema';
import type { ModeratorAssignmentPort } from '../common/providers/moderator-assignment.port';

/**
 * ACC-13 for airline moderators: the ModeratorAssignmentPort implemented on
 * top of the service FlightsModule exports.
 *
 * It holds no logic of its own. `airlineModeratorAssignment` belongs to the
 * flights module (A2), which wrote AirlinesService.assignModerator as the only
 * writer of that collection, so this adapter is the thin piece that keeps
 * administration from reading or writing the collection itself.
 *
 * The hotel half of ACC-13 has no adapter yet: the hotels module (B1, HTL-01)
 * does not exist, so HOTEL_MODERATOR_ASSIGNMENT_PORT is left unprovided and
 * the gateway answers 501.
 */
@Injectable()
export class AirlineModeratorAssignmentAdapter
  implements ModeratorAssignmentPort
{
  constructor(private readonly airlines: AirlinesService) {}

  async assertAssignable(
    providerId: string,
    actingAdminId: string,
  ): Promise<void> {
    // As the admin, so a deactivated airline is visible rather than hidden
    // behind the 404 a guest would get.
    const airline = await this.airlines.findOne(providerId, {
      userId: actingAdminId,
      role: 'ADMIN',
    });
    if (airline.status === AirlineStatus.DEACTIVATED) {
      throw new BadRequestException({
        code: 'PROVIDER_DEACTIVATED',
        message: 'This airline is deactivated and cannot be given a moderator',
        errors: [
          { field: 'providerId', messages: ['airline is deactivated'] },
        ],
      });
    }
  }

  assign(moderatorId: string, providerId: string): Promise<void> {
    return this.airlines.assignModerator(moderatorId, providerId);
  }
}
