import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelReview, HotelReviewSchema } from './schemas/hotel-review.schema';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { InventoryModule } from '../inventory/inventory.module';
import { HotelsModule } from '../hotels.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelReview.name, schema: HotelReviewSchema },
    ]),
    InventoryModule,
    HotelsModule,
    AuthModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
