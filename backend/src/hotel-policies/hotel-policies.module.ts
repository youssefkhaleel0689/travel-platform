import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelPolicy, HotelPolicySchema } from './schemas/hotel-policy.schema';
import { HotelPoliciesController } from './hotel-policies.controller';
import { HotelPoliciesService } from './hotel-policies.service';
import { HotelsModule } from '../hotels/hotels.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelPolicy.name, schema: HotelPolicySchema },
    ]),
    HotelsModule,
  ],
  controllers: [HotelPoliciesController],
  providers: [HotelPoliciesService],
  exports: [HotelPoliciesService],
})
export class HotelPoliciesModule {}
