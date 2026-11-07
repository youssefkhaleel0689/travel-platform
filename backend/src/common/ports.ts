// Integration "ports" to modules owned by other team members (Payments / Notifications).
// They are OPTIONAL: if the team has not provided them yet, B2 logs a warning and carries on,
// so B2 can be run and tested on its own. See README for how to provide them.

export const HOTEL_NOTIFICATIONS = 'HOTEL_NOTIFICATIONS';
export const HOTEL_PAYMENTS = 'HOTEL_PAYMENTS';

export interface HotelNotificationsPort {
  notify(input: {
    userId: string;
    type: 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'REFUND_ISSUED';
    title: string;
    message: string;
    resourceType: 'HOTEL_BOOKING';
    resourceId: string;
  }): Promise<void>;
}

export interface HotelPaymentsPort {
  /** PAY-03: create a Stripe refund + refund record. Returns the refund record id (or null if nothing was created). */
  requestRefund(input: {
    bookingId: string;
    paymentId?: string;
    amount: string;
    refundPercentage: number;
    reason: string;
    policySnapshot: unknown;
  }): Promise<{ refundId: string } | null>;
  /** PAY-01: when a hold expires the PaymentIntent must be cancelled. */
  cancelPaymentForBooking(bookingId: string): Promise<void>;
}
