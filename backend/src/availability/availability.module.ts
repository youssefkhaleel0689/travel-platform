import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { InventoryModule } from '../inventory/inventory.module';
import { HotelCoreModule } from '../hotel-core/hotel-core.module';

@Module({
  imports: [InventoryModule, HotelCoreModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
