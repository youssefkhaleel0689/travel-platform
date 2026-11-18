import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExchangeRatesService } from './exchange-rates.service';
import {
  ExchangeRateSnapshot,
  ExchangeRateSnapshotSchema,
} from './schemas/exchange-rate-snapshot.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRateSnapshot.name, schema: ExchangeRateSnapshotSchema },
    ]),
  ],
  controllers: [ExchangeRatesController],
  providers: [ExchangeRatesService],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}
