import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ReferenceDataModule } from './common/reference-data/reference-data.module';
import { FlightsModule } from './flights/flights.module';

// B2 (Hotel side)
import { HotelSearchModule } from './hotel-search/hotel-search.module';
import { RoomsModule } from './rooms/rooms.module';
import { AvailabilityModule } from './availability/availability.module';
import { HotelPoliciesModule } from './hotel-policies/hotel-policies.module';
import { HotelBookingsModule } from './hotel-bookings/hotel-bookings.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),

    // HotelSearchModule must stay before B1's hotels module so GET /hotels/search
    // is registered before GET /hotels/:id.
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
