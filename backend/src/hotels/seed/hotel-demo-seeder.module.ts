import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { Hotel, HotelSchema } from '../schemas/hotel.schema';
import { HotelDemoSeeder } from './hotel-demo-seeder.service';

// Standalone module for `npm run seed:hotels`; no HTTP server is started.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    MongooseModule.forFeature([{ name: Hotel.name, schema: HotelSchema }]),
    InventoryModule,
    AuthModule,
  ],
  providers: [HotelDemoSeeder],
})
export class HotelDemoSeedModule {}
