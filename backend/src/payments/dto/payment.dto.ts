import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingType } from '../../common/bookings/booking-status';
import { decimal128ToString } from '../../common/money/money';
import { PaymentStatus } from '../payment-status.enum';
import { PaymentDocument } from '../schemas/payment.schema';

/**
 * PAY-01: a payment as the user sees it.
 *
 * There is nothing here about a card, because nothing about a card is stored:
 * only the Stripe id, the amount, the currency and the status
 * (noCardCredentials).
 */
export class PaymentDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60910' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.HOTEL })
  bookingType: BookingType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  bookingId: string;

  @ApiProperty({
    example: 'pi_3QabcdEFghijKLmn0PqRs',
    description: 'Stripe PaymentIntent id, test mode',
  })
  stripePaymentIntentId: string;

  @ApiProperty({
    example: '420.00',
    description: 'A string, because money is stored as Decimal128',
  })
  amount: string;

  @ApiProperty({ example: 'USD', description: 'Always the platform currency (PAY-04)' })
  currency: string;

  @ApiProperty({
    enum: PaymentStatus,
    example: PaymentStatus.REQUIRES_PAYMENT_METHOD,
    description:
      'Refreshed from Stripe on every read, so it is never stale because a ' +
      'webhook has not arrived yet',
  })
  status: PaymentStatus;

  @ApiProperty({
    example: 1,
    description: '1 for the first attempt, then 2, 3, ... on each retry',
  })
  attempt: number;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60900' })
  policyAcceptanceId: string;

  @ApiPropertyOptional({ nullable: true, example: null })
  succeededAt: string | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  failedAt: string | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  cancelledAt: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description: "Stripe's own message for a failed attempt",
  })
  failureMessage: string | null;

  @ApiProperty({ example: '2026-11-09T12:00:00.000Z' })
  createdAt: string;

  static fromDocument(payment: PaymentDocument): PaymentDto {
    const dto = new PaymentDto();
    dto.id = payment._id.toString();
    dto.bookingType = payment.bookingType;
    dto.bookingId = payment.bookingId.toString();
    dto.stripePaymentIntentId = payment.stripePaymentIntentId;
    dto.amount = decimal128ToString(payment.amount) ?? '0.00';
    dto.currency = payment.currency;
    dto.status = payment.status;
    dto.attempt = payment.attempt;
    dto.policyAcceptanceId = payment.policyAcceptanceId.toString();
    dto.succeededAt = payment.succeededAt?.toISOString() ?? null;
    dto.failedAt = payment.failedAt?.toISOString() ?? null;
    dto.cancelledAt = payment.cancelledAt?.toISOString() ?? null;
    dto.failureMessage = payment.failureMessage ?? null;
    dto.createdAt = payment.createdAt.toISOString();
    return dto;
  }
}
