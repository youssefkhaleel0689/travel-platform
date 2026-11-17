import {
  Inject,
  Injectable,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { Role } from '../auth/auth.enums';
import {
  AIRLINE_MODERATOR_ASSIGNMENT_PORT,
  HOTEL_MODERATOR_ASSIGNMENT_PORT,
} from './moderator-assignment.port';
// Types only: a type in a decorated constructor signature has to be imported
// this way while isolatedModules and emitDecoratorMetadata are both on.
import type { ModeratorAssignmentPort } from './moderator-assignment.port';

/** The two roles ACC-13 can create. Anything else is not a moderator. */
export type ModeratorRole = Role.AIRLINE_MODERATOR | Role.HOTEL_MODERATOR;

/**
 * Routes a moderator role to the module that owns its link collection.
 *
 * Both ports are optional, so the application runs with neither, one or both
 * of them wired. While a provider module is still being built, asking for one
 * of its moderators answers 501 PROVIDER_TYPE_UNAVAILABLE with a message that
 * says so, instead of the app refusing to start or a 500 that looks like a bug
 * in ACC-13.
 */
@Injectable()
export class ModeratorAssignmentsGateway {
  constructor(
    @Optional()
    @Inject(AIRLINE_MODERATOR_ASSIGNMENT_PORT)
    private readonly airlinePort?: ModeratorAssignmentPort,
    @Optional()
    @Inject(HOTEL_MODERATOR_ASSIGNMENT_PORT)
    private readonly hotelPort?: ModeratorAssignmentPort,
  ) {}

  /** True when the module that owns this role's providers is wired in. */
  supports(role: ModeratorRole): boolean {
    return this.port(role) !== undefined;
  }

  // Both methods are async rather than returning the port's promise directly,
  // so an unwired type REJECTS with the 501 instead of throwing it
  // synchronously. A caller that only writes .catch() would otherwise miss it.

  /** See ModeratorAssignmentPort.assertAssignable. */
  async assertAssignable(
    role: ModeratorRole,
    providerId: string,
    actingAdminId: string,
  ): Promise<void> {
    await this.portOrThrow(role).assertAssignable(providerId, actingAdminId);
  }

  /** See ModeratorAssignmentPort.assign. */
  async assign(
    role: ModeratorRole,
    moderatorId: string,
    providerId: string,
  ): Promise<void> {
    await this.portOrThrow(role).assign(moderatorId, providerId);
  }

  private port(role: ModeratorRole): ModeratorAssignmentPort | undefined {
    return role === Role.AIRLINE_MODERATOR ? this.airlinePort : this.hotelPort;
  }

  private portOrThrow(role: ModeratorRole): ModeratorAssignmentPort {
    const port = this.port(role);
    if (!port) {
      throw new NotImplementedException({
        code: 'PROVIDER_TYPE_UNAVAILABLE',
        message:
          role === Role.AIRLINE_MODERATOR
            ? 'Airline moderators cannot be created yet: airlines are not connected to account administration'
            : 'Hotel moderators cannot be created yet: the hotels module has not been built',
      });
    }
    return port;
  }
}
