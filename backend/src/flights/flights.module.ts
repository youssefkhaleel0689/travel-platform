import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesController } from './airlines/airlines.controller';
import { AirlinesService } from './airlines/airlines.service';
import {
  AirlineModeratorAssignment,
  AirlineModeratorAssignmentSchema,
} from './schemas/airline-moderator-assignment.schema';
import { Airline, AirlineSchema } from './schemas/airline.schema';

// Flights feature module. FLT-01 adds airlines; later PRs add flights, cabins and policies here.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      {
        name: AirlineModeratorAssignment.name,
        schema: AirlineModeratorAssignmentSchema,
      },
    ]),
  ],
  controllers: [AirlinesController],
  providers: [AirlinesService],
  exports: [AirlinesService],
})
export class FlightsModule {}
