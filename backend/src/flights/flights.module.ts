import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { AirlinesController } from './airlines/airlines.controller';
import { AirlinesService } from './airlines/airlines.service';
import { CabinsController } from './cabins/cabins.controller';
import { CabinsService } from './cabins/cabins.service';
import { FlightsController } from './flights/flights.controller';
import { FlightsService } from './flights/flights.service';
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

// Flights feature module. FLT-01 adds airlines, FLT-03 the flight model and POST /flights,
// FLT-04 the cabins, FLT-22 the seat inventory (Khaled); later PRs add the edit, cancel and
// policy endpoints here.
@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      {
        name: AirlineModeratorAssignment.name,
        schema: AirlineModeratorAssignmentSchema,
      },
    ]),
  ],
  controllers: [AirlinesController, FlightsController, CabinsController],
  providers: [
    AirlinesService,
    FlightsService,
    CabinsService,
    SeatInventoryService,
  ],
  exports: [AirlinesService, SeatInventoryService],
})
export class FlightsModule {}
