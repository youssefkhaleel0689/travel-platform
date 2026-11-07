import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { InventoryModule } from '../inventory/inventory.module';
import { B2CommonModule } from '../common/b2-common.module';

@Module({
  imports: [InventoryModule, B2CommonModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
