import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingType } from '../../common/bookings/booking-status';
import { decimal128ToString } from '../../common/money/money';
import { CancelledBy, RefundStatus } from '../refund-status.enum';
import { RefundDocument } from '../schemas/refund.schema';

// PAY-03: the refund as it appears on the booking details.
export class RefundDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60920' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.HOTEL })
  bookingType: BookingType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  bookingId: string;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60910' })
  paymentId: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 're_3QabcdEFghijKLmn0',
    description: 'Stripe refund id; null until Stripe has answered',
  })
  stripeRefundId: string | null;

  @ApiProperty({ example: '210.00', description: 'A string: stored as Decimal128' })
  amount: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    enum: RefundStatus,
    example: RefundStatus.REFUNDED,
    description: 'PENDING, REFUNDED or FAILED',
  })
  status: RefundStatus;

  @ApiProperty({
    enum: CancelledBy,
    example: CancelledBy.USER,
    description: 'A provider cancellation is always refunded in full',
  })
  cancelledBy: CancelledBy;

  @ApiProperty({ example: 'Cancelled by the traveller 5 days before check-in' })
  reason: string;

  @ApiProperty({
    example: 50,
    description: "The provider's tier that was applied, 0 to 100",
  })
  refundPercentage: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The cancellation terms the percentage came from, so the amount can ' +
      'still be explained after the provider edits its policy',
    example: {
      cancellationTiers: [{ daysBeforeCheckIn: 7, refundPercentage: 100 }],
    },
  })
  policySnapshot: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-11-09T12:00:00.000Z' })
  requestedAt: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-11-09T12:00:02.000Z' })
  completedAt: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description: "Stripe's message when a refund was refused",
  })
  failureMessage: string | null;

  static fromDocument(refund: RefundDocument): RefundDto {
    const dto = new RefundDto();
    dto.id = refund._id.toString();
    dto.bookingType = refund.bookingType;
    dto.bookingId = refund.bookingId.toString();
    dto.paymentId = refund.paymentId.toString();
    dto.stripeRefundId = refund.stripeRefundId ?? null;
    dto.amount = decimal128ToString(refund.amount) ?? '0.00';
    dto.currency = refund.currency;
    dto.status = refund.status;
    dto.cancelledBy = refund.cancelledBy;
    dto.reason = refund.reason;
    dto.refundPercentage = refund.refundPercentage;
    dto.policySnapshot = refund.policySnapshot ?? null;
    dto.requestedAt = refund.requestedAt.toISOString();
    dto.completedAt = refund.completedAt?.toISOString() ?? null;
    dto.failureMessage = refund.failureMessage ?? null;
    return dto;
  }
}
