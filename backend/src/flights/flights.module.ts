import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { AirlinesController } from './airlines/airlines.controller';
import { AirlinesService } from './airlines/airlines.service';
import { FlightSearchController } from './flight-search/flight-search.controller';
import { FlightSearchService } from './flight-search/flight-search.service';
import {
  AirlineModeratorAssignment,
  AirlineModeratorAssignmentSchema,
} from './schemas/airline-moderator-assignment.schema';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';
import { SeatInventoryService } from './seat-inventory/seat-inventory.service';

// Flights feature module. FLT-01 adds airlines and FLT-03 the flight model; later PRs add
// the flight, cabin and policy endpoints here.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      {
        name: AirlineModeratorAssignment.name,
        schema: AirlineModeratorAssignmentSchema,
      },
    ]),
    // Search checks airports and reads their time zones (FLT-11, GEN-06).
    ReferenceDataModule,
  ],
  controllers: [AirlinesController, FlightSearchController],
  providers: [AirlinesService, FlightSearchService, SeatInventoryService],
  // FlightSearchService is exported for itineraries (ITN-26), SeatInventoryService for
  // payments (FLT-23 and the hold expiry).
  exports: [AirlinesService, FlightSearchService, SeatInventoryService],
})
export class FlightsModule {}
