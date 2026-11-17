import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { InventoryModule } from '../inventory/inventory.module';
import { HotelsModule } from '../hotels.module';

@Module({
  imports: [InventoryModule, HotelsModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
