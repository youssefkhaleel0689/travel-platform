import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AirlinesController } from './airlines/airlines.controller';
import { AirlinesService } from './airlines/airlines.service';
import { CabinsController } from './cabins/cabins.controller';
import { CabinsService } from './cabins/cabins.service';
import { FlightCancellationController } from './flight-cancellation/flight-cancellation.controller';
import { FlightCancellationService } from './flight-cancellation/flight-cancellation.service';
import { FlightDetailsController } from './flight-details/flight-details.controller';
import { FlightDetailsService } from './flight-details/flight-details.service';
import { FlightSearchController } from './flight-search/flight-search.controller';
import { FlightSearchService } from './flight-search/flight-search.service';
import { FlightStatusJob } from './flight-status/flight-status.job';
import { FlightStatusService } from './flight-status/flight-status.service';
import { FlightsController } from './flights/flights.controller';
import { FlightsService } from './flights/flights.service';
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

// Flights feature module. FLT-01 adds airlines, FLT-03 the flight model and POST /flights,
// FLT-04 the cabins, FLT-08/09 the airline policy, FLT-22 the seat inventory (Khaled), FLT-30 the
// job that marks flights DEPARTED; later PRs add the edit and cancel endpoints here.
@Module({
  imports: [
    ReferenceDataModule,
    // FLT-05 (time-change notices) and FLT-06 (cancellation notices).
    NotificationsModule,
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
  controllers: [
    AirlinesController,
    AirlinePoliciesController,
    FlightsController,
    CabinsController,
    // FLT-06: POST /flights/:id/cancel.
    FlightCancellationController,
    FlightSearchController,
    // Last: its GET /flights/:id would otherwise take GET /flights/search (FLT-17).
    FlightDetailsController,
  ],
  providers: [
    AirlinesService,
    AirlinePoliciesService,
    FlightsService,
    CabinsService,
    FlightCancellationService,
    FlightSearchService,
    FlightDetailsService,
    FlightStatusService,
    FlightStatusJob,
    SeatInventoryService,
  ],
  // FlightSearchService is exported for itineraries (ITN-26), SeatInventoryService for
  // payments (FLT-23 and the hold expiry).
  exports: [
    AirlinesService,
    AirlinePoliciesService,
    FlightSearchService,
    FlightStatusService,
    SeatInventoryService,
  ],
})
export class FlightsModule {}
