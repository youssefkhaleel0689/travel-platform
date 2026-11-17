import { Module } from '@nestjs/common';
import { HotelSearchController } from './hotel-search.controller';
import { HotelSearchService } from './hotel-search.service';
import { InventoryModule } from '../inventory/inventory.module';
import { HotelsModule } from '../hotels/hotels.module';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';

@Module({
  imports: [InventoryModule, HotelsModule, ReferenceDataModule],
  controllers: [HotelSearchController],
  providers: [HotelSearchService],
  exports: [HotelSearchService],
})
export class HotelSearchModule {}
