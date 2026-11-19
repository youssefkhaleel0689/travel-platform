import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsModule } from '../common/bookings/bookings.module';
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
import { ItineraryBookingsController } from './itinerary-bookings.controller';
import { ItineraryBookingsService } from './itinerary-bookings.service';
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
    // ITN-27: reads the owner's bookings through the shared gateway (GEN-11).
    BookingsModule,
  ],
  controllers: [
    ItinerariesController,
    DaysController,
    ActivitiesController,
    ActivityImagesController,
    BudgetsController,
    BudgetSummaryController,
    PublicItinerariesController,
    ItineraryBookingsController,
  ],
  providers: [
    ItinerariesService,
    DaysService,
    ActivitiesService,
    BudgetsService,
    ItineraryBudgetSummaryService,
    ItineraryBookingsService,
    PublicItinerariesService,
  ],
  exports: [ItinerariesService, PublicItinerariesService],
})
export class ItinerariesModule {}
