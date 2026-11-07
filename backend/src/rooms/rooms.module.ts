import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { InventoryModule } from '../inventory/inventory.module';
import { B2CommonModule } from '../common/b2-common.module';

@Module({
  imports: [InventoryModule, B2CommonModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
