// Schema section 6: refunds.status.
export enum RefundStatus {
  /** Sent to Stripe, not settled yet. */
  PENDING = 'PENDING',
  /** Stripe accepted it and the money is on its way back. */
  REFUNDED = 'REFUNDED',
  /** Stripe refused it. The cancellation stands; the refund can be retried. */
  FAILED = 'FAILED',
}

export const REFUND_STATUSES = Object.values(RefundStatus);

/** Who cancelled, which decides the refund share (PAY-03). */
export enum CancelledBy {
  /** The traveller. The provider's cancellation tiers apply (FLT-09, HTL-10). */
  USER = 'USER',
  /** The airline or hotel. Always a full refund. */
  PROVIDER = 'PROVIDER',
  /**
   * The platform itself: a payment succeeded after the booking's hold had
   * expired, so there is nothing to confirm. Always a full refund (PAY-01).
   */
  SYSTEM = 'SYSTEM',
}

/** Maps a Stripe refund status onto ours. */
export function fromStripeRefundStatus(stripeStatus: string | null): RefundStatus {
  switch (stripeStatus) {
    case 'succeeded':
      return RefundStatus.REFUNDED;
    case 'pending':
    case 'requires_action':
      return RefundStatus.PENDING;
    case 'failed':
    case 'canceled':
      return RefundStatus.FAILED;
    default:
      // An unknown status is treated as still pending rather than refunded, so
      // nothing is reported as returned before Stripe says it was.
      return RefundStatus.PENDING;
  }
}
