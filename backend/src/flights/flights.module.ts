import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesController } from './airlines/airlines.controller';
import { AirlinesService } from './airlines/airlines.service';
import { AirlinePoliciesController } from './policies/airline-policies.controller';
import { AirlinePoliciesService } from './policies/airline-policies.service';
import {
  AirlineModeratorAssignment,
  AirlineModeratorAssignmentSchema,
} from './schemas/airline-moderator-assignment.schema';
import {
  AirlinePolicy,
  AirlinePolicySchema,
} from './schemas/airline-policy.schema';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';
import { SeatInventoryService } from './seat-inventory/seat-inventory.service';

// Flights feature module. FLT-01 adds airlines, FLT-03 the flight model and FLT-08/09 the
// airline policy; later PRs add the flight and cabin endpoints here.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: AirlinePolicy.name, schema: AirlinePolicySchema },
      { name: Flight.name, schema: FlightSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      {
        name: AirlineModeratorAssignment.name,
        schema: AirlineModeratorAssignmentSchema,
      },
    ]),
  ],
  controllers: [AirlinesController, AirlinePoliciesController],
  providers: [AirlinesService, AirlinePoliciesService, SeatInventoryService],
  exports: [AirlinesService, AirlinePoliciesService, SeatInventoryService],
})
export class FlightsModule {}
