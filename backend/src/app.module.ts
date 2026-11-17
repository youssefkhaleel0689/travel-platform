import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ReferenceDataModule } from './common/reference-data/reference-data.module';
import { FlightsModule } from './flights/flights.module';

// B2 (Hotel side) — feature modules live flat in src/.
import { HotelCoreModule } from './hotel-core/hotel-core.module';
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
      }),
    }),

    // HotelSearchModule must stay before a future GET /hotels/:id controller so
    // GET /hotels/search is registered first.
    HotelCoreModule,
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
