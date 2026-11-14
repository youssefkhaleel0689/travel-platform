import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { AirlinesController } from './airlines/airlines.controller';
import { AirlinesService } from './airlines/airlines.service';
import { FlightSearchService } from './flight-search/flight-search.service';
import {
  AirlineModeratorAssignment,
  AirlineModeratorAssignmentSchema,
} from './schemas/airline-moderator-assignment.schema';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

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
    // Search checks airports and reads their time zones (FLT-11, GEN-06).
    ReferenceDataModule,
  ],
  controllers: [AirlinesController],
  providers: [AirlinesService, FlightSearchService],
  // FlightSearchService is exported for itineraries (ITN-26).
  exports: [AirlinesService, FlightSearchService],
})
export class FlightsModule {}
