import { Module } from '@nestjs/common';
import { ReferenceDataModule } from '../../common/reference-data/reference-data.module';
import { ItinerariesModule } from '../../itineraries/itineraries.module';
import { FlightsModule } from '../flights.module';
import { ItineraryFlightsController } from './itinerary-flights.controller';
import { ItineraryFlightsService } from './itinerary-flights.service';

// ITN-26 on its own module: it needs both FlightsModule (FlightSearchService) and
// ItinerariesModule (ItinerariesService), and neither of those should import the other.
@Module({
  imports: [FlightsModule, ItinerariesModule, ReferenceDataModule],
  controllers: [ItineraryFlightsController],
  providers: [ItineraryFlightsService],
})
export class ItineraryFlightsModule {}
