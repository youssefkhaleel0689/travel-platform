import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HOTEL_BOOKINGS_PORT } from '../common/bookings/bookings.port';
import { HotelPoliciesModule } from '../hotel-policies/hotel-policies.module';
import { HotelsModule } from '../hotels/hotels.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingMaintenanceWorker } from './booking-maintenance.worker';
import {
  HotelBookingsController,
  HotelReservationsController,
} from './hotel-bookings.controller';
import { HotelBookingsPort } from './hotel-bookings.port';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  HotelNotificationsAdapter,
  HotelPaymentsAdapter,
} from './hotel-integration.adapters';
import { HOTEL_NOTIFICATIONS, HOTEL_PAYMENTS } from './hotel-integration.ports';

/**
 * Hotel reservations (HTL-16 to HTL-23).
 *
 * @Global so that HOTEL_BOOKINGS_PORT reaches BookingsGateway: the gateway
 * lives in BookingsModule under src/common/, which must not import a feature
 * module, and Nest only resolves a provider from a module's own imports or
 * from a global module. Without it the gateway's optional hotel port stays
 * empty and payments answer 501 for every hotel booking. The flights module
 * needs the same for FLIGHT_BOOKINGS_PORT.
 */
@Global()
@Module({
  imports: [
    InventoryModule,
    HotelPoliciesModule,
    HotelsModule,
    AuthModule,
    NotificationsModule,
  ],
  controllers: [HotelBookingsController, HotelReservationsController],
  providers: [
    HotelBookingsService,
    HotelBookingsPort,
    { provide: HOTEL_BOOKINGS_PORT, useExisting: HotelBookingsPort },
    { provide: HOTEL_NOTIFICATIONS, useClass: HotelNotificationsAdapter },
    { provide: HOTEL_PAYMENTS, useClass: HotelPaymentsAdapter },
    BookingMaintenanceWorker,
  ],
  exports: [HotelBookingsService, HOTEL_BOOKINGS_PORT],
})
export class HotelBookingsModule {}
