// What the hotel reservations need from the Payments (C2, PAY-03) and
// Notifications (C2, GEN-01) modules. HotelBookingsModule provides both tokens
// with the adapters in hotel-integration.adapters.ts. They stay @Optional in
// the service, so a unit test can leave them out.

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
}
