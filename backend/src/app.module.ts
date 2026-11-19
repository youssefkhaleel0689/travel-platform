import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdministrationModule } from './administration/administration.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ReferenceDataModule } from './common/reference-data/reference-data.module';
import { FlightBookingsModule } from './flights/flight-bookings/flight-bookings.module';
import { FlightsModule } from './flights/flights.module';
import { ItineraryFlightsModule } from './flights/itinerary-flights/itinerary-flights.module';
import { HotelsModule } from './hotels/hotels.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { ItinerariesModule } from './itineraries/itineraries.module';

// B2 (Hotel side) — feature modules live flat in src/.
import { HotelSearchModule } from './hotel-search/hotel-search.module';
import { RoomsModule } from './rooms/rooms.module';
import { AvailabilityModule } from './availability/availability.module';
import { HotelPoliciesModule } from './hotel-policies/hotel-policies.module';
import { HotelBookingsModule } from './hotel-bookings/hotel-bookings.module';
import { ReviewsModule } from './reviews/reviews.module';

// B1's hotel profile module (src/hotels/) is deliberately NOT registered here:
// it owns the same Hotel models and its controller needs its own integration.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        // The whole team shares one Atlas cluster, and its connection limit is
        // for all of us together: eight dev servers plus test runs against the
        // driver's default of 100 sockets each can exhaust it, which shows up
        // as connections that hang rather than as a clear error. Ten is ample
        // for this API and leaves room for everyone else.
        maxPoolSize: 10,
      }),
    }),

    // HotelSearchModule must stay before HotelsModule so GET /hotels/search is
    // registered before GET /hotels/:id (otherwise "search" is read as an id).
    HotelSearchModule,
    HotelsModule,
    RoomsModule,
    AvailabilityModule,
    HotelPoliciesModule,
    HotelBookingsModule,
    ReviewsModule,
    ReferenceDataModule,
    AuthModule,
    FlightsModule,
    FlightBookingsModule,
    NotificationsModule,
    AdministrationModule,
    PaymentsModule,
    ItinerariesModule,
    // ITN-26: flight search from an itinerary (needs FlightsModule and ItinerariesModule).
    ItineraryFlightsModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
