import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HotelBookingsService } from './hotel-bookings.service';

/**
 * B2 side of the shared booking contract used by C2's Stripe webhook
 * (src/common/bookings/bookings.port.ts on the payments branch). The shapes and
 * the token are kept identical to that contract; once those shared files are
 * on develop this file can import the types instead of mirroring them.
 *
 * C2's gateway calls confirmAfterPayment(bookingType, bookingId, paymentId);
 * this port receives (bookingId, paymentId).
 */
export const HOTEL_BOOKINGS_PORT = 'HOTEL_BOOKINGS_PORT';

export enum BookingStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum BookingType {
  FLIGHT = 'FLIGHT',
  HOTEL = 'HOTEL',
}

export enum ProviderType {
  AIRLINE = 'AIRLINE',
  HOTEL = 'HOTEL',
}

export enum HoldReleaseReason {
  HOLD_EXPIRED = 'HOLD_EXPIRED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
}

export interface PayableBooking {
  bookingId: string;
  bookingType: BookingType;
  userId: string;
  status: BookingStatus;
  totalAmount: string;
  currency: string;
  holdExpiresAt: Date | null;
  bookingReference: string | null;
  providerType: ProviderType;
  providerId: string;
}

export interface BookingPolicies {
  bookingId: string;
  bookingType: BookingType;
  providerType: ProviderType;
  providerId: string;
  policyVersion: number;
  policySnapshot: Record<string, unknown>;
}

export interface BookingConfirmation {
  bookingId: string;
  status: BookingStatus;
  bookingReference: string;
}

export interface BookingsPort {
  findPayable(bookingId: string): Promise<PayableBooking | null>;
  findPolicies(bookingId: string): Promise<BookingPolicies | null>;
  confirmAfterPayment(
    bookingId: string,
    paymentId: string,
  ): Promise<BookingConfirmation>;
  releaseHold(bookingId: string, reason: HoldReleaseReason): Promise<void>;
  hasUpcomingConfirmedBookings(userId: string): Promise<boolean>;
}

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
      status: booking.status as unknown as BookingStatus,
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
    const result = await this.bookings.confirmAfterPayment(bookingId, paymentId);
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
}
