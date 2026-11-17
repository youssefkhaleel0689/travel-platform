import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ReferenceDataModule } from './common/reference-data/reference-data.module';
import { FlightsModule } from './flights/flights.module';

// B2 (Hotel side)
import { HotelsModule } from './hotels/hotels.module';
import { HotelSearchModule } from './hotels/search/hotel-search.module';
import { RoomsModule } from './hotels/rooms/rooms.module';
import { AvailabilityModule } from './hotels/availability/availability.module';
import { HotelPoliciesModule } from './hotels/policies/hotel-policies.module';
import { HotelBookingsModule } from './hotels/bookings/hotel-bookings.module';
import { ReviewsModule } from './hotels/reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),

    // HotelSearchModule must stay before a future GET /hotels/:id controller so
    // GET /hotels/search is registered first.
    HotelsModule,
    HotelSearchModule,
    RoomsModule,
    AvailabilityModule,
    HotelPoliciesModule,
    HotelBookingsModule,
    ReviewsModule,
    ReferenceDataModule,
    FlightsModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
