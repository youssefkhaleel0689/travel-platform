import { Module } from '@nestjs/common';
import { HotelSearchModule } from '../../hotel-search/hotel-search.module';
import { ItinerariesModule } from '../itineraries.module';
import { ItineraryHotelsController } from './itinerary-hotels.controller';
import { ItineraryHotelsService } from './itinerary-hotels.service';

// ITN-25 on its own module, like ITN-26: it needs both HotelSearchModule
// (HotelSearchService) and ItinerariesModule, and neither should import the other.
@Module({
  imports: [HotelSearchModule, ItinerariesModule],
  controllers: [ItineraryHotelsController],
  providers: [ItineraryHotelsService],
})
export class ItineraryHotelsModule {}
