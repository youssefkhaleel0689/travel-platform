import { AuditModule } from '../audit/audit.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaModule } from '../media/media.module';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AirlineBookingsController } from './airline-bookings/airline-bookings.controller';
import { AirlineBookingsService } from './airline-bookings/airline-bookings.service';
import { AirlineLogoController } from './airlines/airline-logo.controller';
import { AirlineLogoService } from './airlines/airline-logo.service';
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
import { MyFlightBookingsController } from './my-bookings/my-flight-bookings.controller';
import { MyFlightBookingsService } from './my-bookings/my-flight-bookings.service';
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
    // FLT-01 / GEN-08: the airline logo is stored by the shared media service.
    MediaModule,
    // FLT-06: the flight cancellation is recorded in the audit log (GEN-07).
    AuditModule,
    // FLT-05 (time-change notices), FLT-06 and FLT-26 (cancellation notices).
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
    AirlineLogoController,
    AirlinePoliciesController,
    FlightsController,
    CabinsController,
    // FLT-06: POST /flights/:id/cancel.
    FlightCancellationController,
    MyFlightBookingsController,
    AirlineBookingsController,
    FlightSearchController,
    // Last: its GET /flights/:id would otherwise take GET /flights/search (FLT-17).
    FlightDetailsController,
  ],
  providers: [
    AirlinesService,
    AirlineLogoService,
    AirlinePoliciesService,
    FlightsService,
    CabinsService,
    FlightCancellationService,
    MyFlightBookingsService,
    AirlineBookingsService,
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
