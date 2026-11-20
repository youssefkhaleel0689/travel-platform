import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model, QueryFilter } from 'mongoose';
import { Types } from 'mongoose';
import { findOwnedOrThrow, ownerFilter } from '../../common/auth/ownership';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  BookingStatus,
  BookingType,
} from '../../common/bookings/booking-status';
import {
  decimal128ToString,
  percentageOf,
  toDecimal128,
} from '../../common/money/money';
import { paginateQuery } from '../../common/pagination/paginate';
import {
  NotificationResourceType,
  NotificationType,
} from '../../notifications/notification-type.enum';
import { NotificationsService } from '../../notifications/notifications.service';
import { CancelledBy } from '../../payments/refund-status.enum';
import { RefundsService } from '../../payments/refunds.service';
import { refundPercentageFor } from '../policies/cancellation-tiers';
import { FlightBooking, FlightSegment } from '../schemas/flight-booking.schema';
import { SeatInventoryService } from '../seat-inventory/seat-inventory.service';
import {
  CancellationBlock,
  FlightBookingGroup,
} from './dto/my-flight-bookings.dto';
import type {
  CancelFlightBookingDto,
  CancellationQuoteDto,
  CancelledFlightBookingDto,
  ListMyFlightBookingsQueryDto,
  MyFlightBookingDto,
  MyFlightBookingsDto,
} from './dto/my-flight-bookings.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

const NOT_FOUND = {
  notFoundCode: 'BOOKING_NOT_FOUND',
  notFoundMessage: 'Booking not found',
};

type LeanBooking = FlightBooking & { _id: Types.ObjectId };

// The seats one segment holds, as SeatInventoryService takes them (infants take none).
function seatsOf(segment: FlightSegment) {
  return {
    flightId: segment.flightId,
    category: segment.cabinCategory,
    seats: segment.seatsRequired,
  };
}

// Whole 24-hour periods from now to the departure; never negative. FLT-09 compares a
// tier's threshold with this: a "7 days" tier applies from 7 x 24 hours before departure.
export function wholeDaysUntil(departure: Date, now: Date): number {
  return Math.max(
    0,
    Math.floor((departure.getTime() - now.getTime()) / DAY_MS),
  );
}

// FLT-25, FLT-26: the signed-in user's own flight bookings. Every query carries the owner
// in its filter (ACC-11), so another account's booking is simply not found.
@Injectable()
export class MyFlightBookingsService {
  private readonly logger = new Logger(MyFlightBookingsService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly seatInventory: SeatInventoryService,
    private readonly notifications: NotificationsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** FLT-25: one group of the user's bookings (page of 10) and the size of every group. */
  async list(
    query: ListMyFlightBookingsQueryDto,
    user: AuthenticatedUser,
  ): Promise<MyFlightBookingsDto> {
    const now = new Date();
    const filterOf = (
      group: FlightBookingGroup,
    ): QueryFilter<FlightBooking> => ({
      ...ownerFilter(user),
      ...this.groupFilter(group, now),
    });

    const [page, upcoming, past, cancelled] = await Promise.all([
      paginateQuery(this.bookingModel, filterOf(query.group), {
        page: query.page,
        sort: this.groupSort(query.group),
      }),
      this.bookingModel
        .countDocuments(filterOf(FlightBookingGroup.UPCOMING))
        .exec(),
      this.bookingModel
        .countDocuments(filterOf(FlightBookingGroup.PAST))
        .exec(),
      this.bookingModel
        .countDocuments(filterOf(FlightBookingGroup.CANCELLED))
        .exec(),
    ]);

    return {
      group: query.group,
      counts: { upcoming, past, cancelled },
      bookings: {
        items: page.items.map((booking) => this.toRow(booking)),
        meta: page.meta,
      },
    };
  }

  /** FLT-26: what cancelling would refund today, shown before the user confirms. */
  async cancellationQuote(
    id: string,
    user: AuthenticatedUser,
  ): Promise<CancellationQuoteDto> {
    const booking = await findOwnedOrThrow(
      this.bookingModel,
      id,
      user,
      NOT_FOUND,
    );
    return this.quoteOf(booking as LeanBooking, new Date());
  }

  /**
   * FLT-26: cancels a CONFIRMED booking before its first flight leaves. In one transaction
   * the booking becomes CANCELLED (with the refund tier of its own policy snapshot) and its
   * booked seats go back through SeatInventoryService. The refund (PAY-03) is requested
   * after the commit: a failed refund never undoes the cancellation, it stays on record
   * and can be retried.
   */
  async cancel(
    id: string,
    dto: CancelFlightBookingDto,
    user: AuthenticatedUser,
  ): Promise<CancelledFlightBookingDto> {
    const booking = (await findOwnedOrThrow(
      this.bookingModel,
      id,
      user,
      NOT_FOUND,
    )) as LeanBooking;
    const now = new Date();
    const quote = this.quoteOf(booking, now);
    if (quote.blockedReason) {
      throw this.blocked(quote.blockedReason, booking);
    }

    const reason = dto.reason ?? null;
    const cancelled = await this.connection.transaction(async (session) => {
      // The filter repeats what was checked above, so two clicks, or a flight cancellation
      // racing this request, cancel the booking only once.
      const updated = await this.bookingModel
        .findOneAndUpdate(
          {
            _id: booking._id,
            ...ownerFilter(user),
            status: BookingStatus.CONFIRMED,
            'segments.0.departureAtUtc': { $gt: now },
          },
          {
            $set: {
              status: BookingStatus.CANCELLED,
              cancelledAt: now,
              cancellation: {
                cancelledBy: new Types.ObjectId(user.userId),
                reason,
                refundPercentage: quote.refundPercentage,
                refundAmount: toDecimal128(quote.refundAmount),
                refundId: null,
                cancelledAt: now,
                tiersSnapshot: booking.policySnapshot.cancellationTiers.map(
                  (tier) => ({
                    daysBeforeDeparture: tier.daysBeforeDeparture,
                    refundPercentage: tier.refundPercentage,
                  }),
                ),
              },
            },
          },
          { session, returnDocument: 'after' },
        )
        .lean<LeanBooking>()
        .exec();
      if (!updated) {
        return null;
      }
      for (const segment of updated.segments) {
        await this.seatInventory.releaseBooked(seatsOf(segment), session);
      }
      return updated;
    });

    if (!cancelled) {
      // Lost a race: say what the booking is now.
      const current = (await findOwnedOrThrow(
        this.bookingModel,
        id,
        user,
        NOT_FOUND,
      )) as LeanBooking;
      throw this.blocked(
        this.quoteOf(current, new Date()).blockedReason ??
          CancellationBlock.NOT_CONFIRMED,
        current,
      );
    }

    const refund = await this.requestRefund(
      cancelled,
      quote.refundPercentage,
      reason,
    );
    // The quoted share of the booking's total. RefundsService refunds the same
    // share of what is still paid, which is that total, but may split it over
    // two payments after a pricier flight change (FLT-27), so the first refund
    // row alone can hold only part of it.
    const refundAmount = refund ? quote.refundAmount : '0.00';
    const refundId = refund ? refund._id : null;
    await this.bookingModel
      .updateOne(
        { _id: cancelled._id },
        {
          $set: {
            'cancellation.refundId': refundId,
            'cancellation.refundAmount': toDecimal128(refundAmount),
          },
        },
      )
      .exec();

    await this.notifications.notify({
      userId: cancelled.userId,
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Flight booking cancelled',
      message:
        `Booking ${cancelled.bookingReference ?? ''} was cancelled. ` +
        `Refund: ${refundAmount} ${cancelled.priceSnapshot.currency} (${quote.refundPercentage}%).`,
      resourceType: NotificationResourceType.FLIGHT_BOOKING,
      resourceId: cancelled._id.toString(),
    });

    return {
      id: cancelled._id.toString(),
      bookingReference: cancelled.bookingReference ?? null,
      status: BookingStatus.CANCELLED,
      cancelledAt: now.toISOString(),
      refundPercentage: quote.refundPercentage,
      refundAmount,
      currency: cancelled.priceSnapshot.currency,
      refundId: refundId ? refundId.toString() : null,
    };
  }

  // RefundsService is looked up when needed, not injected: payments reaches flights only
  // through FLIGHT_BOOKINGS_PORT, and injecting it here would close a provider cycle (the
  // same reason the hotel adapter does it). A failure is logged and never undoes the
  // cancellation (PAY-03 records it as FAILED).
  private async requestRefund(
    booking: LeanBooking,
    refundPercentage: number,
    reason: string | null,
  ) {
    try {
      const refunds = this.moduleRef.get(RefundsService, { strict: false });
      return await refunds.issueForCancellation({
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
        cancelledBy: CancelledBy.USER,
        refundPercentage,
        reason: reason ?? 'Cancelled by the passenger',
        policySnapshot: {
          airlineId: booking.policySnapshot.airlineId.toString(),
          version: booking.policySnapshot.version,
          cancellationTiers: booking.policySnapshot.cancellationTiers.map(
            (tier) => ({
              daysBeforeDeparture: tier.daysBeforeDeparture,
              refundPercentage: tier.refundPercentage,
            }),
          ),
        },
      });
    } catch (error) {
      this.logger.error(
        `Refund of flight booking ${booking._id.toString()} failed after the cancellation`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  private quoteOf(booking: LeanBooking, now: Date): CancellationQuoteDto {
    // A round trip is cancelled as a whole, with the outbound tier (FLT-12).
    const departure = booking.segments[0].departureAtUtc;
    const daysRemaining = wholeDaysUntil(departure, now);
    const tiers = booking.policySnapshot.cancellationTiers.map((tier) => ({
      daysBeforeDeparture: tier.daysBeforeDeparture,
      refundPercentage: tier.refundPercentage,
    }));
    const refundPercentage = refundPercentageFor(tiers, daysRemaining);
    const total = decimal128ToString(booking.priceSnapshot.total) ?? '0.00';

    let blockedReason: CancellationBlock | null = null;
    if (booking.status !== BookingStatus.CONFIRMED) {
      blockedReason = CancellationBlock.NOT_CONFIRMED;
    } else if (departure.getTime() <= now.getTime()) {
      blockedReason = CancellationBlock.DEPARTURE_PASSED;
    }

    return {
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference ?? null,
      canCancel: blockedReason === null,
      blockedReason,
      departureAtUtc: departure.toISOString(),
      daysRemaining,
      refundPercentage,
      refundAmount: percentageOf(total, refundPercentage),
      currency: booking.priceSnapshot.currency,
      tiers,
    };
  }

  private blocked(
    reason: CancellationBlock,
    booking: LeanBooking,
  ): ConflictException {
    if (reason === CancellationBlock.DEPARTURE_PASSED) {
      return new ConflictException({
        code: 'DEPARTURE_PASSED',
        message: 'This booking can no longer be cancelled: its flight has left',
      });
    }
    return new ConflictException({
      code: 'BOOKING_NOT_CANCELLABLE',
      message:
        booking.status === BookingStatus.PENDING_PAYMENT
          ? 'Only a paid (CONFIRMED) booking can be cancelled; an unpaid hold expires by itself'
          : `A ${booking.status} booking cannot be cancelled`,
    });
  }

  // The status and departure conditions of each group (FLT-25).
  private groupFilter(
    group: FlightBookingGroup,
    now: Date,
  ): QueryFilter<FlightBooking> {
    switch (group) {
      case FlightBookingGroup.UPCOMING:
        return {
          status: BookingStatus.CONFIRMED,
          'segments.departureAtUtc': { $gt: now },
        };
      case FlightBookingGroup.PAST:
        return {
          $or: [
            { status: BookingStatus.COMPLETED },
            {
              status: BookingStatus.CONFIRMED,
              segments: {
                $not: { $elemMatch: { departureAtUtc: { $gt: now } } },
              },
            },
          ],
        };
      case FlightBookingGroup.CANCELLED:
        return { status: BookingStatus.CANCELLED };
    }
  }

  private groupSort(group: FlightBookingGroup): Record<string, 1 | -1> {
    switch (group) {
      case FlightBookingGroup.UPCOMING:
        return { 'segments.0.departureAtUtc': 1 };
      case FlightBookingGroup.PAST:
        return { 'segments.0.departureAtUtc': -1 };
      case FlightBookingGroup.CANCELLED:
        return { cancelledAt: -1 };
    }
  }

  private toRow(booking: LeanBooking): MyFlightBookingDto {
    const cancellation = booking.cancellation;
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference ?? null,
      status: booking.status,
      tripType: booking.tripType,
      segments: booking.segments.map((segment) => ({
        flightNumber: segment.flightNumber,
        departureAirportId: segment.departureAirportId,
        arrivalAirportId: segment.arrivalAirportId,
        departureAtUtc: segment.departureAtUtc.toISOString(),
        arrivalAtUtc: segment.arrivalAtUtc.toISOString(),
        cabin: segment.cabinCategory,
      })),
      passengerCount: booking.passengers.length,
      total: decimal128ToString(booking.priceSnapshot.total) ?? '0.00',
      currency: booking.priceSnapshot.currency,
      confirmedAt: booking.confirmedAt?.toISOString() ?? null,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      refund: cancellation
        ? {
            percentage: cancellation.refundPercentage,
            amount: decimal128ToString(cancellation.refundAmount) ?? '0.00',
          }
        : null,
    };
  }
}
