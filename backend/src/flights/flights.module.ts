import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { AirlinesController } from './airlines/airlines.controller';
import { AirlinesService } from './airlines/airlines.service';
import { FlightsController } from './flights/flights.controller';
import { FlightsService } from './flights/flights.service';
import {
  AirlineModeratorAssignment,
  AirlineModeratorAssignmentSchema,
} from './schemas/airline-moderator-assignment.schema';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

// Flights feature module. FLT-01 adds airlines, FLT-03 the flight model and POST /flights;
// later PRs add the cabin, edit, cancel and policy endpoints here.
@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      {
        name: AirlineModeratorAssignment.name,
        schema: AirlineModeratorAssignmentSchema,
      },
    ]),
  ],
  controllers: [AirlinesController, FlightsController],
  providers: [AirlinesService, FlightsService],
  exports: [AirlinesService],
})
export class FlightsModule {}
