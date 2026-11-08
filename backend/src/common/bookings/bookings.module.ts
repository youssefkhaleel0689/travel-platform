import { Module } from '@nestjs/common';
import { BookingPaymentGateway } from './booking-payment.gateway';

/**
 * GEN-11. Holds the shared booking lifecycle and the port the payments module
 * reads bookings through.
 *
 * It owns no collection and imports no feature module, so it can live in
 * src/common/ without creating an import cycle: flights and hotels keep their
 * own booking collections and provide the ports from their own modules.
 */
@Module({
  providers: [BookingPaymentGateway],
  exports: [BookingPaymentGateway],
})
export class BookingsModule {}
