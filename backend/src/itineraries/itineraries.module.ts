import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { MediaModule } from '../media/media.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ActivityImagesController } from './activity-images.controller';
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
    ReferenceDataModule,
    // ITN-12: activity images through the shared media store (GEN-08).
    MediaModule,
  ],
  controllers: [
    ItinerariesController,
    DaysController,
    ActivitiesController,
    ActivityImagesController,
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
  exports: [ItinerariesService, PublicItinerariesService],
})
export class ItinerariesModule {}
