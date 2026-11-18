import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import {
  AIRLINE_MODERATOR_ASSIGNMENT_PORT,
  HOTEL_MODERATOR_ASSIGNMENT_PORT,
} from '../common/providers/moderator-assignment.port';
import { ModeratorAssignmentsGateway } from '../common/providers/moderator-assignments.gateway';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminModeratorsController } from './admin-moderators.controller';
import { AdminModeratorsService } from './admin-moderators.service';
import { AirlineModeratorAssignmentAdapter } from './airline-moderator-assignment.adapter';
import { HotelModeratorAssignmentAdapter } from './hotel-moderator-assignment.adapter';

/**
 * The administration module (ACC-07a, ACC-13, ACC-14, ACC-16, and later
 * ACC-15, ACC-17, GEN-07, GEN-09, GEN-10).
 *
 * It owns no collection of its own: it works through UsersService and
 * NotificationsService, which is why the account rules cannot drift between
 * the admin routes and the account's own routes. ACC-13 also needs the provider
 * side of the moderator link, which belongs to the flights and hotels modules,
 * so it goes through the services those modules export rather than the
 * collections.
 *
 * ModeratorAssignmentsGateway is provided here rather than in a module of its
 * own under common/, which is where BookingsGateway lives. That is on purpose:
 * BookingsModule exists because two modules consume it (auth for ACC-12 and
 * payments), while this gateway has exactly one consumer. If a second module
 * ever needs it, move it to a common/providers/providers.module.ts then.
 */
@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    FlightsModule,
    HotelsModule,
    // GEN-07: every account action below is written to the audit log.
    AuditModule,
  ],
  controllers: [AdminAccountsController, AdminModeratorsController],
  providers: [
    AdminAccountsService,
    AdminModeratorsService,
    ModeratorAssignmentsGateway,
    {
      provide: AIRLINE_MODERATOR_ASSIGNMENT_PORT,
      useClass: AirlineModeratorAssignmentAdapter,
    },
    {
      provide: HOTEL_MODERATOR_ASSIGNMENT_PORT,
      useClass: HotelModeratorAssignmentAdapter,
    },
  ],
  exports: [AdminAccountsService, AdminModeratorsService],
})
export class AdministrationModule {}
