import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesController } from './airlines/airlines.controller';
import { AirlinesService } from './airlines/airlines.service';
import {
  AirlineModeratorAssignment,
  AirlineModeratorAssignmentSchema,
} from './schemas/airline-moderator-assignment.schema';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';
import { SeatInventoryService } from './seat-inventory/seat-inventory.service';

// Flights feature module. FLT-01 adds airlines and FLT-03 the flight model; later PRs add
// the flight, cabin and policy endpoints here.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      {
        name: AirlineModeratorAssignment.name,
        schema: AirlineModeratorAssignmentSchema,
      },
    ]),
  ],
  controllers: [AirlinesController],
  providers: [AirlinesService, SeatInventoryService],
  exports: [AirlinesService, SeatInventoryService],
})
export class FlightsModule {}
