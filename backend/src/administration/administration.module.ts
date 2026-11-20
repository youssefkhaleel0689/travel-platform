import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../common/bookings/bookings.module';
import {
  AIRLINE_MODERATOR_ASSIGNMENT_PORT,
  HOTEL_MODERATOR_ASSIGNMENT_PORT,
} from '../common/providers/moderator-assignment.port';
import { ModeratorAssignmentsGateway } from '../common/providers/moderator-assignments.gateway';
import { FlightBookingsModule } from '../flights/flight-bookings/flight-bookings.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { HotelsModule } from '../hotels/hotels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminModeratorsController } from './admin-moderators.controller';
import { AdminModeratorsService } from './admin-moderators.service';
import { AdminProvidersController } from './admin-providers.controller';
import { AdminProvidersService } from './admin-providers.service';
import { AirlineModeratorAssignmentAdapter } from './airline-moderator-assignment.adapter';
import { HotelModeratorAssignmentAdapter } from './hotel-moderator-assignment.adapter';

/**
 * The administration module (ACC-07a, ACC-13, ACC-14, ACC-16, ACC-17, and later
 * ACC-15, GEN-07, GEN-09, GEN-10).
 *
 * It owns no collection of its own: it works through UsersService and
 * NotificationsService, which is why the account rules cannot drift between
 * the admin routes and the account's own routes. ACC-13 also needs the provider
 * side of the moderator link, which belongs to the flights and hotels modules,
 * so it goes through the services those modules export rather than the
 * collections.
 *
 * ACC-15's provider half (AdminProvidersService) works the same way: the status
 * change is HotelsService / AirlinesService's own, and the users to notify come
 * from the read-only methods HotelBookingsModule and FlightBookingsModule
 * export. Neither of those imports this module, so there is no cycle.
 *
 * ModeratorAssignmentsGateway is provided here rather than in a module of its
 * own under common/, which is where BookingsGateway lives. That is on purpose:
 * BookingsModule exists because several modules consume it (auth for ACC-12,
 * payments, and this module for ACC-17), while this gateway has exactly one
 * consumer. If a second module
 * ever needs it, move it to a common/providers/providers.module.ts then.
 */
@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    FlightsModule,
    HotelsModule,
    // ACC-15: who holds upcoming bookings with a provider (read-only).
    HotelBookingsModule,
    FlightBookingsModule,
    AuditModule,
    // ACC-17 reads both booking collections through BookingsGateway, never
    // through the flights or hotels models.
    BookingsModule,
  ],
  controllers: [
    AdminAccountsController,
    AdminAnalyticsController,
    AdminBookingsController,
    AdminModeratorsController,
    AdminProvidersController,
  ],
  providers: [
    AdminAccountsService,
    AdminAnalyticsService,
    AdminBookingsService,
    AdminModeratorsService,
    AdminProvidersService,
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
