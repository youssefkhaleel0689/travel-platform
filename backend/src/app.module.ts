import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdministrationModule } from './administration/administration.module';
import { AuthModule } from './auth/auth.module';
import { ReferenceDataModule } from './common/reference-data/reference-data.module';
import { FlightsModule } from './flights/flights.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';

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
    ReferenceDataModule,
    AuthModule,
    FlightsModule,
    NotificationsModule,
    AdministrationModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
