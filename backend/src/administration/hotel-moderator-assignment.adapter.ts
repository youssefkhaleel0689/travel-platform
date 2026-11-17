import { BadRequestException, Injectable } from '@nestjs/common';
import type { ModeratorAssignmentPort } from '../common/providers/moderator-assignment.port';
import { HotelStatus } from '../hotels/schemas/hotel.schema';
import { HotelsService } from '../hotels/hotels.service';

/**
 * ACC-13 for hotel moderators: the ModeratorAssignmentPort implemented on top
 * of the service HotelsModule exports, the same way
 * AirlineModeratorAssignmentAdapter does it for airlines.
 *
 * It holds no logic of its own. `hotelModeratorAssignment` belongs to the
 * hotels module (HTL-01), whose HotelsService.assignModerator is the only
 * writer of that collection.
 */
@Injectable()
export class HotelModeratorAssignmentAdapter implements ModeratorAssignmentPort {
  constructor(private readonly hotels: HotelsService) {}

  async assertAssignable(
    providerId: string,
    actingAdminId: string,
  ): Promise<void> {
    // As the admin, so a deactivated hotel is visible rather than hidden
    // behind the 404 a guest would get.
    const hotel = await this.hotels.findById(providerId, {
      id: actingAdminId,
      role: 'ADMIN',
    });
    if (hotel.status === HotelStatus.DEACTIVATED) {
      throw new BadRequestException({
        code: 'PROVIDER_DEACTIVATED',
        message: 'This hotel is deactivated and cannot be given a moderator',
        errors: [{ field: 'hotelId', messages: ['hotel is deactivated'] }],
      });
    }
  }

  async assign(moderatorId: string, providerId: string): Promise<void> {
    await this.hotels.assignModerator(moderatorId, providerId);
  }
}
