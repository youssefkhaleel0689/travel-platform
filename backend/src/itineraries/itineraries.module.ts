import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { BudgetSummaryController } from './budget-summary.controller';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { DaysController } from './days.controller';
import { DaysService } from './days.service';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBudgetSummaryService } from './itinerary-budget-summary.service';
import { PublicItinerariesController } from './public-itineraries.controller';
import { PublicItinerariesService } from './public-itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    ExchangeRatesModule,
  ],
  controllers: [
    ItinerariesController,
    DaysController,
    ActivitiesController,
    BudgetsController,
    BudgetSummaryController,
    PublicItinerariesController,
  ],
  providers: [
    ItinerariesService,
    DaysService,
    ActivitiesService,
    BudgetsService,
    ItineraryBudgetSummaryService,
    PublicItinerariesService,
  ],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
