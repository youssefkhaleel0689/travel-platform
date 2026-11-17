import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { City, CitySchema } from '../common/reference-data/schemas/city.schema';
import {
  Country,
  CountrySchema,
} from '../common/reference-data/schemas/country.schema';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import {
  HotelModeratorAssignment,
  HotelModeratorAssignmentSchema,
} from './schemas/hotel-moderator-assignment.schema';
import { Hotel, HotelSchema } from './schemas/hotel.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      {
        name: HotelModeratorAssignment.name,
        schema: HotelModeratorAssignmentSchema,
      },
      // Seeded reference data, read-only: validates cityId / countryId.
      { name: City.name, schema: CitySchema },
      { name: Country.name, schema: CountrySchema },
    ]),
  ],
  controllers: [HotelsController],
  providers: [HotelsService],
  // Other modules (administration / C2, hotel side / B2) use the service,
  // never the models (README: module conventions).
  exports: [HotelsService],
})
export class HotelsModule {}
