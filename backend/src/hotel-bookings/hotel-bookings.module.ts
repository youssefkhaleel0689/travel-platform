import { Module } from '@nestjs/common';
import {
  HotelBookingsController,
  HotelReservationsController,
} from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  HOTEL_BOOKINGS_PORT,
  HotelBookingsPort,
} from './hotel-bookings.port';
import { BookingMaintenanceWorker } from './booking-maintenance.worker';
import { InventoryModule } from '../inventory/inventory.module';
import { HotelPoliciesModule } from '../hotel-policies/hotel-policies.module';
import { HotelCoreModule } from '../hotel-core/hotel-core.module';
import { AuthModule } from '../auth/auth.module';

// Optional integration providers (HOTEL_NOTIFICATIONS, HOTEL_PAYMENTS) are provided by the team's
// Notifications / Payments modules; see README.
@Module({
  imports: [
    InventoryModule,
    HotelPoliciesModule,
    HotelCoreModule,
    AuthModule,
  ],
  controllers: [HotelBookingsController, HotelReservationsController],
  providers: [
    HotelBookingsService,
    HotelBookingsPort,
    { provide: HOTEL_BOOKINGS_PORT, useExisting: HotelBookingsPort },
    BookingMaintenanceWorker,
  ],
  exports: [HotelBookingsService, HOTEL_BOOKINGS_PORT],
})
export class HotelBookingsModule {}
