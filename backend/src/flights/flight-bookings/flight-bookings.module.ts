import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FLIGHT_BOOKINGS_PORT } from '../../common/bookings/bookings.port';
import { ReferenceDataModule } from '../../common/reference-data/reference-data.module';
import { Airline, AirlineSchema } from '../schemas/airline.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../schemas/flight-booking.schema';
import { Flight, FlightSchema } from '../schemas/flight.schema';
import { FlightsModule } from '../flights.module';
import { FlightBookingPolicyReader } from './flight-booking-policy.reader';
import { FlightBookingsPortAdapter } from './flight-bookings-port.adapter';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { FlightHoldExpiryService } from './flight-hold-expiry.service';
import { SeatSelectionController } from './seat-selection.controller';
import { SeatSelectionService } from './seat-selection.service';

// Flight bookings (FLT-19, FLT-21, FLT-22): the summary, the hold and the bookings the
// payments module reads.
//
// Global for one reason: BookingsGateway (common/bookings, C2) is created inside
// BookingsModule and asks for FLIGHT_BOOKINGS_PORT there. common/ must never import a
// feature module, so BookingsModule cannot import this one; a global module's exports are
// visible to every module, BookingsModule included. Besides the port token,
// FlightBookingsService is exported for one read-only caller: the administration module
// (ACC-15) asks it which users hold upcoming CONFIRMED bookings with an airline. That
// adds no cycle, because nothing this module imports imports administration.
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
    // SeatInventoryService: the only code that writes the seat counters (FLT-22).
    FlightsModule,
    ReferenceDataModule,
  ],
  controllers: [FlightBookingsController, SeatSelectionController],
  providers: [
    FlightBookingsService,
    FlightBookingPolicyReader,
    FlightBookingsPortAdapter,
    { provide: FLIGHT_BOOKINGS_PORT, useExisting: FlightBookingsPortAdapter },
    // Its @Cron runs through ScheduleModule.forRoot(), registered once in PaymentsModule.
    FlightHoldExpiryService,
    SeatSelectionService,
  ],
  exports: [FLIGHT_BOOKINGS_PORT, FlightBookingsService],
})
export class FlightBookingsModule {}
