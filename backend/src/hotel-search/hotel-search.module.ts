import { Module } from '@nestjs/common';
import { HotelSearchController } from './hotel-search.controller';
import { HotelSearchService } from './hotel-search.service';
import { InventoryModule } from '../inventory/inventory.module';
import { B2CommonModule } from '../common/b2-common.module';

@Module({
  imports: [InventoryModule, B2CommonModule],
  controllers: [HotelSearchController],
  providers: [HotelSearchService],
  exports: [HotelSearchService],
})
export class HotelSearchModule {}
