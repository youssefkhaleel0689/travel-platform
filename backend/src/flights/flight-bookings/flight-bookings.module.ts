import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../../common/reference-data/reference-data.module';
import { Airline, AirlineSchema } from '../schemas/airline.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../schemas/flight-booking.schema';
import { Flight, FlightSchema } from '../schemas/flight.schema';
import { FlightsModule } from '../flights.module';
import { FlightBookingPolicyReader } from './flight-booking-policy.reader';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';

// Flight bookings (FLT-19, FLT-21, FLT-22): the summary, the hold and the bookings the
// payments module reads.
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
  controllers: [FlightBookingsController],
  providers: [FlightBookingsService, FlightBookingPolicyReader],
})
export class FlightBookingsModule {}
