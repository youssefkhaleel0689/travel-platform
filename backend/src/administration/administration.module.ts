import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AIRLINE_MODERATOR_ASSIGNMENT_PORT } from '../common/providers/moderator-assignment.port';
import { ModeratorAssignmentsGateway } from '../common/providers/moderator-assignments.gateway';
import { FlightsModule } from '../flights/flights.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminModeratorsController } from './admin-moderators.controller';
import { AdminModeratorsService } from './admin-moderators.service';
import { AirlineModeratorAssignmentAdapter } from './airline-moderator-assignment.adapter';

/**
 * The administration module (ACC-07a, ACC-13, ACC-14, ACC-16, and later
 * ACC-15, ACC-17, GEN-07, GEN-09, GEN-10).
 *
 * It owns no collection of its own: it works through UsersService and
 * NotificationsService, which is why the account rules cannot drift between
 * the admin routes and the account's own routes. ACC-13 also needs the airline
 * side of the moderator link, which belongs to the flights module, so it goes
 * through the service FlightsModule exports rather than the collection.
 *
 * ModeratorAssignmentsGateway is provided here rather than in a module of its
 * own under common/, which is where BookingsGateway lives. That is on purpose:
 * BookingsModule exists because two modules consume it (auth for ACC-12 and
 * payments), while this gateway has exactly one consumer. If a second module
 * ever needs it, move it to a common/providers/providers.module.ts then.
 *
 * HOTEL_MODERATOR_ASSIGNMENT_PORT is deliberately left unprovided: the hotels
 * module does not exist yet (B1, HTL-01), so asking for a hotel moderator
 * answers 501 rather than failing to start. Providing that token is all it
 * takes to finish the hotel half of ACC-13.
 */
@Module({
  imports: [AuthModule, NotificationsModule, FlightsModule],
  controllers: [AdminAccountsController, AdminModeratorsController],
  providers: [
    AdminAccountsService,
    AdminModeratorsService,
    ModeratorAssignmentsGateway,
    {
      provide: AIRLINE_MODERATOR_ASSIGNMENT_PORT,
      useClass: AirlineModeratorAssignmentAdapter,
    },
  ],
  exports: [AdminAccountsService, AdminModeratorsService],
})
export class AdministrationModule {}
