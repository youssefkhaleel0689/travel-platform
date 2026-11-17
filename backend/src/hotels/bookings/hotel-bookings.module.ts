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
import { HotelPoliciesModule } from '../policies/hotel-policies.module';
import { HotelsModule } from '../hotels.module';
import { AuthModule } from '../../auth/auth.module';

// Optional integration providers (HOTEL_NOTIFICATIONS, HOTEL_PAYMENTS) are provided by the team's
// Notifications / Payments modules; see README.
@Module({
  imports: [
    InventoryModule,
    HotelPoliciesModule,
    HotelsModule,
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
