// Schema section 6 "Enums": notifications.type. The list is closed, so a
// module cannot invent a type the frontend does not know how to render.
export enum NotificationType {
  /** PAY-01: the verified payment confirmed a booking (GEN-11). */
  BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
  /** FLT-26, HTL-21: a user or a provider cancelled a booking. */
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  /** PAY-03: a refund was requested through Stripe. */
  REFUND_ISSUED = 'REFUND_ISSUED',
  /** FLT-05: a confirmed flight's times moved. */
  FLIGHT_SCHEDULE_CHANGED = 'FLIGHT_SCHEDULE_CHANGED',
  /** FLT-06: the airline cancelled the flight. */
  FLIGHT_CANCELLED = 'FLIGHT_CANCELLED',
  /** ACC-16: an admin suspended the account. */
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  /** ACC-15: an admin deactivated the hotel or airline. */
  PROVIDER_SUSPENDED = 'PROVIDER_SUSPENDED',
}

export const NOTIFICATION_TYPES = Object.values(NotificationType);

/** What a notification points at, so the frontend can link to it. */
export enum NotificationResourceType {
  FLIGHT_BOOKING = 'FLIGHT_BOOKING',
  HOTEL_BOOKING = 'HOTEL_BOOKING',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  FLIGHT = 'FLIGHT',
  AIRLINE = 'AIRLINE',
  HOTEL = 'HOTEL',
  ACCOUNT = 'ACCOUNT',
}

export const NOTIFICATION_RESOURCE_TYPES = Object.values(
  NotificationResourceType,
);
