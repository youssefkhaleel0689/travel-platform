/**
 * Schema section 6: payments.status. These mirror the Stripe PaymentIntent
 * states the platform cares about, so the stored status can always be
 * reconciled with Stripe rather than guessed.
 */
export enum PaymentStatus {
  /** The PaymentIntent exists and is waiting for the card details. */
  REQUIRES_PAYMENT_METHOD = 'REQUIRES_PAYMENT_METHOD',
  /** Stripe is working on it; the outcome is not known yet. */
  PROCESSING = 'PROCESSING',
  /** Stripe confirmed the money was taken. Only this confirms a booking. */
  SUCCEEDED = 'SUCCEEDED',
  /** The attempt failed. The user may retry while the hold lasts. */
  FAILED = 'FAILED',
  /** Cancelled, in practice because the hold ran out. */
  CANCELLED = 'CANCELLED',
}

export const PAYMENT_STATUSES = Object.values(PaymentStatus);

/** No further Stripe activity is expected on these. */
export const TERMINAL_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
];

/** A payment in one of these is the booking's live attempt. */
export const OPEN_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.REQUIRES_PAYMENT_METHOD,
  PaymentStatus.PROCESSING,
];

/**
 * Maps a Stripe PaymentIntent status onto ours.
 *
 * requires_payment_method, requires_confirmation, requires_action and
 * requires_capture all mean the same thing to this platform: the money has not
 * been taken and the user still has something to do. Keeping them apart would
 * add states no rule depends on.
 */
export function fromStripeStatus(stripeStatus: string): PaymentStatus {
  switch (stripeStatus) {
    case 'succeeded':
      return PaymentStatus.SUCCEEDED;
    case 'processing':
      return PaymentStatus.PROCESSING;
    case 'canceled':
      return PaymentStatus.CANCELLED;
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'requires_capture':
      return PaymentStatus.REQUIRES_PAYMENT_METHOD;
    default:
      // An unknown status must not be read as success. Treating it as failed
      // is the safe direction: a booking stays unconfirmed and the user can
      // retry, instead of a booking being confirmed without money.
      return PaymentStatus.FAILED;
  }
}
