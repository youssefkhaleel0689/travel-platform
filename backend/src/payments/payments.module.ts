import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../common/bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingPoliciesController } from './booking-policies.controller';
import { PolicyAcceptancesService } from './policy-acceptances.service';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from './schemas/policy-acceptance.schema';

/**
 * Payments, policy acceptances and refunds (PAY-01 to PAY-04).
 *
 * It owns the payments, refunds, policyAcceptances and stripeWebhookEvents
 * collections and reads bookings only through BookingsGateway, so the flights
 * and hotels modules keep their own inventory rules.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
    ]),
    AuthModule,
    BookingsModule,
    NotificationsModule,
  ],
  controllers: [BookingPoliciesController],
  providers: [PolicyAcceptancesService],
  exports: [PolicyAcceptancesService],
})
export class PaymentsModule {}
