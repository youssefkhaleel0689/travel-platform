import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import {
  Availability,
  AvailabilitySchema,
} from '../availability/schemas/availability.schema';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: Availability.name, schema: AvailabilitySchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
  ],
  providers: [InventoryService],
  exports: [InventoryService, MongooseModule],
})
export class InventoryModule {}
