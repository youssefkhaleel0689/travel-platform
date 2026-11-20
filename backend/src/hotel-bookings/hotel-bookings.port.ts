import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HotelBookingsService } from './hotel-bookings.service';

import {
  BookingStatus,
  BookingType,
  ProviderType,
} from '../common/bookings/booking-status';
import type {
  AdminBookingFilter,
  AdminBookingList,
  BookingConfirmation,
  BookingPolicies,
  BookingsPort,
  HoldReleaseReason,
  PayableBooking,
} from '../common/bookings/bookings.port';

/**
 * The hotel side of the shared BookingsPort (GEN-11, PAY-01, PAY-02, ACC-12),
 * provided as HOTEL_BOOKINGS_PORT by HotelBookingsModule. C2's gateway calls
 * confirmAfterPayment(bookingType, bookingId, paymentId); this port receives
 * (bookingId, paymentId).
 */
@Injectable()
export class HotelBookingsPort implements BookingsPort {
  constructor(private readonly bookings: HotelBookingsService) {}

  async findPayable(bookingId: string): Promise<PayableBooking | null> {
    const booking = await this.bookings.findForPort(bookingId);
    if (!booking) return null;
    return {
      bookingId: String(booking._id),
      bookingType: BookingType.HOTEL,
      userId: String(booking.userId),
      status: booking.status,
      totalAmount: booking.totalPrice.toString(),
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt ?? null,
      bookingReference: booking.bookingReference ?? null,
      providerType: ProviderType.HOTEL,
      providerId: String(booking.hotelId),
    };
  }

  async findPolicies(bookingId: string): Promise<BookingPolicies | null> {
    const booking = await this.bookings.findForPort(bookingId);
    if (!booking) return null;
    const snapshot = booking.policySnapshot;
    return {
      bookingId: String(booking._id),
      bookingType: BookingType.HOTEL,
      providerType: ProviderType.HOTEL,
      providerId: String(booking.hotelId),
      policyVersion: snapshot.policyVersion,
      policySnapshot: {
        policyVersion: snapshot.policyVersion,
        checkInTime: snapshot.checkInTime,
        checkOutTime: snapshot.checkOutTime,
        cancellationTiers: snapshot.cancellationTiers,
      },
    };
  }

  async confirmAfterPayment(
    bookingId: string,
    paymentId: string,
  ): Promise<BookingConfirmation> {
    const result = await this.bookings.confirmAfterPayment(
      bookingId,
      paymentId,
    );
    if (!result.confirmed) {
      if (result.reason === 'HOLD_EXPIRED') {
        throw new ConflictException({
          code: 'HOLD_EXPIRED',
          message: 'The hold expired before the payment was confirmed',
        });
      }
      throw new ConflictException({
        code: 'INVALID_BOOKING_STATE',
        message: `A booking in ${result.reason ?? 'this state'} cannot be confirmed`,
      });
    }
    if (!result.booking.bookingReference) {
      throw new NotFoundException('Confirmed booking has no reference');
    }
    return {
      bookingId: String(result.booking._id),
      status: BookingStatus.CONFIRMED,
      bookingReference: result.booking.bookingReference,
    };
  }

  async releaseHold(
    bookingId: string,
    _reason: HoldReleaseReason,
  ): Promise<void> {
    // Both reasons free the inventory; the service records EXPIRED once only.
    await this.bookings.releaseHoldForPort(bookingId);
  }

  hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    return this.bookings.hasUpcomingConfirmedForPort(userId);
  }

  /** ACC-17: a page of reservations for the admin list, newest first. */
  listForAdmin(filter: AdminBookingFilter): Promise<AdminBookingList> {
    return this.bookings.listForAdminPort(filter);
  }
}
