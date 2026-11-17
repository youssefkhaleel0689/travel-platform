import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { InventoryModule } from '../inventory/inventory.module';
import { HotelCoreModule } from '../hotel-core/hotel-core.module';

@Module({
  imports: [InventoryModule, HotelCoreModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
