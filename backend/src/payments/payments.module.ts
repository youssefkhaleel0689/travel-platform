import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../common/bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingPoliciesController } from './booking-policies.controller';
import { PaymentExpiryService } from './payment-expiry.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsWebhookService } from './payments-webhook.service';
import { PolicyAcceptancesService } from './policy-acceptances.service';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from './schemas/policy-acceptance.schema';
import {
  StripeWebhookEvent,
  StripeWebhookEventSchema,
} from './schemas/stripe-webhook-event.schema';
import { StripeService } from './stripe.service';

/**
 * Payments, policy acceptances and refunds (PAY-01 to PAY-04).
 *
 * It owns the payments, refunds, policyAcceptances and stripeWebhookEvents
 * collections and reads bookings only through BookingsGateway, so the flights
 * and hotels modules keep their own inventory rules.
 *
 * ScheduleModule.forRoot is registered here because this is the first module
 * that needs a scheduled job (the hold-expiry sweep). Calling it again in
 * another module is harmless, but one registration in AppModule would be
 * tidier once a second module needs one.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: StripeWebhookEvent.name, schema: StripeWebhookEventSchema },
    ]),
    ScheduleModule.forRoot(),
    AuthModule,
    BookingsModule,
    NotificationsModule,
  ],
  controllers: [
    BookingPoliciesController,
    PaymentsController,
    RefundsController,
  ],
  providers: [
    StripeService,
    PolicyAcceptancesService,
    PaymentsService,
    PaymentsWebhookService,
    PaymentSettlementService,
    PaymentExpiryService,
    RefundsService,
  ],
  exports: [
    StripeService,
    PolicyAcceptancesService,
    PaymentsService,
    PaymentExpiryService,
    RefundsService,
  ],
})
export class PaymentsModule {}
