import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { InventoryModule } from '../inventory/inventory.module';
import { HotelsModule } from '../hotels/hotels.module';

@Module({
  imports: [InventoryModule, HotelsModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
