import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelReview, HotelReviewSchema } from './schemas/hotel-review.schema';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { InventoryModule } from '../inventory/inventory.module';
import { B2CommonModule } from '../common/b2-common.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: HotelReview.name, schema: HotelReviewSchema }]), InventoryModule, B2CommonModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
