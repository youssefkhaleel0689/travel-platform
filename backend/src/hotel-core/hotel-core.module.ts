import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { HotelsService } from './hotels.service';
import {
  HotelModeratorAssignment,
  HotelModeratorAssignmentSchema,
} from './schemas/hotel-moderator-assignment.schema';
import { Hotel, HotelSchema } from './schemas/hotel.schema';

// HTL-01. Owns the Hotel and HotelModeratorAssignment models. Other modules
// import this module and use the exported service, never these models.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      {
        name: HotelModeratorAssignment.name,
        schema: HotelModeratorAssignmentSchema,
      },
    ]),
    ReferenceDataModule,
  ],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelCoreModule {}
