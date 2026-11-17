import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BookingType } from '../common/bookings/booking-status';
import {
  NotificationResourceType,
  NotificationType,
} from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { CancelledBy } from '../payments/refund-status.enum';
import { RefundsService } from '../payments/refunds.service';
import type {
  HotelNotificationsPort,
  HotelPaymentsPort,
} from './hotel-integration.ports';

/**
 * GEN-01: hotel reservation notices go through C2's NotificationsService.
 * NotificationsService never throws, so a missed notice never fails a
 * cancellation.
 */
@Injectable()
export class HotelNotificationsAdapter implements HotelNotificationsPort {
  constructor(private readonly notifications: NotificationsService) {}

  async notify(
    input: Parameters<HotelNotificationsPort['notify']>[0],
  ): Promise<void> {
    await this.notifications.notify({
      userId: input.userId,
      type: NotificationType[input.type],
      title: input.title,
      message: input.message,
      resourceType: NotificationResourceType.HOTEL_BOOKING,
      resourceId: input.resourceId,
    });
  }
}

/**
 * PAY-03 / HTL-21: a cancelled reservation is refunded through C2's
 * RefundsService, which finds the captured payment, calls the Stripe Refunds
 * API, records the refund and notifies the user.
 *
 * RefundsService is looked up when a refund is needed rather than injected.
 * Injecting it would close a provider cycle: BookingsGateway (payments) needs
 * HOTEL_BOOKINGS_PORT, which needs HotelBookingsService, which would need
 * RefundsService, which needs PaymentsService, which needs BookingsGateway.
 * A lookup at call time breaks it without forwardRef.
 */
@Injectable()
export class HotelPaymentsAdapter implements HotelPaymentsPort {
  constructor(private readonly moduleRef: ModuleRef) {}

  async requestRefund(
    input: Parameters<HotelPaymentsPort['requestRefund']>[0],
  ): Promise<{ refundId: string } | null> {
    const refunds = this.moduleRef.get(RefundsService, { strict: false });
    const refund = await refunds.issueForCancellation({
      bookingType: BookingType.HOTEL,
      bookingId: input.bookingId,
      cancelledBy: CancelledBy.USER,
      refundPercentage: input.refundPercentage,
      reason: input.reason,
      policySnapshot: (input.policySnapshot ?? null) as Record<
        string,
        unknown
      > | null,
    });
    return refund ? { refundId: refund._id.toString() } : null;
  }
}
