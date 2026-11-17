import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesController } from './airlines/airlines.controller';
import { AirlinesService } from './airlines/airlines.service';
import { FlightStatusJob } from './flight-status/flight-status.job';
import { FlightStatusService } from './flight-status/flight-status.service';
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

// Flights feature module. FLT-01 adds airlines and FLT-03 the flight model and FLT-30 the
// job that marks flights DEPARTED; later PRs add the flight, cabin and policy endpoints here.
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
  ],
  controllers: [AirlinesController],
  providers: [
    AirlinesService,
    FlightStatusService,
    FlightStatusJob,
    SeatInventoryService,
  ],
  exports: [AirlinesService, FlightStatusService, SeatInventoryService],
})
export class FlightsModule {}
