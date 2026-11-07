import { Module } from '@nestjs/common';
import { HotelBookingsController, HotelReservationsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { BookingMaintenanceWorker } from './booking-maintenance.worker';
import { InventoryModule } from '../inventory/inventory.module';
import { HotelPoliciesModule } from '../hotel-policies/hotel-policies.module';
import { B2CommonModule } from '../common/b2-common.module';

// Optional integration providers (HOTEL_NOTIFICATIONS, HOTEL_PAYMENTS) are provided by the team's
// Notifications / Payments modules; see README.
@Module({
  imports: [InventoryModule, HotelPoliciesModule, B2CommonModule],
  controllers: [HotelBookingsController, HotelReservationsController],
  providers: [HotelBookingsService, BookingMaintenanceWorker],
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
