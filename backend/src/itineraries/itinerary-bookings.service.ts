import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import Decimal from 'decimal.js';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { BookingStatus, BookingType } from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import type { PayableBooking } from '../common/bookings/bookings.port';
import { PLATFORM_CURRENCY } from '../common/money/money';
import type {
  BookingLinkDto,
  LinkBookingDto,
  LinkedBookingsSummaryDto,
} from './dto/booking-link.dto';
import { ItinerariesService } from './itineraries.service';
import { dateOfDay } from './itinerary-days.logic';
import { findDayOrThrow } from './itinerary-lookup';
import {
  BookingLink,
  Itinerary,
  ItineraryDocument,
} from './schemas/itinerary.schema';

export const BOOKING_NOT_FOUND = {
  code: 'BOOKING_NOT_FOUND',
  message: 'Booking not found',
} as const;
export const BOOKING_LINK_NOT_FOUND = {
  code: 'BOOKING_LINK_NOT_FOUND',
  message: 'Booking link not found',
} as const;
export const BOOKING_NOT_CONFIRMED = {
  code: 'BOOKING_NOT_CONFIRMED',
  message: 'Only a CONFIRMED or COMPLETED booking can be linked',
} as const;
export const BOOKING_ALREADY_LINKED = {
  code: 'BOOKING_ALREADY_LINKED',
  message: 'This booking is already linked to this itinerary',
} as const;

const OBJECT_ID = /^[0-9a-f]{24}$/i;

// A booking counts in the budget only while it is paid for and not cancelled.
const COUNTED_STATUSES: readonly BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
];

const show = (value: Decimal): string =>
  value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/**
 * ITN-27 (bonus): the owner's own flight and hotel bookings, linked to itinerary
 * days, feeding the budget. Bookings are read through the shared BookingsGateway
 * (GEN-11), the same way payments read them, so this module never touches the
 * flight or hotel collections.
 */
@Injectable()
export class ItineraryBookingsService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
    private readonly itineraries: ItinerariesService,
    private readonly bookings: BookingsGateway,
  ) {}

  async link(
    user: AuthenticatedUser,
    itineraryId: string,
    dto: LinkBookingDto,
  ): Promise<BookingLinkDto> {
    const doc = await this.itineraries.findOwnedOrThrow(user, itineraryId);
    const day = findDayOrThrow(doc, dto.dayId);

    // Someone else's booking is the same 404 as a missing one (ACC-11).
    const booking = await this.readBooking(dto.bookingType, dto.bookingId);
    if (!booking || booking.userId !== user.userId) {
      throw new NotFoundException(BOOKING_NOT_FOUND);
    }
    if (!COUNTED_STATUSES.includes(booking.status)) {
      throw new ConflictException(BOOKING_NOT_CONFIRMED);
    }

    const link = {
      _id: new Types.ObjectId(),
      bookingType: dto.bookingType,
      bookingId: new Types.ObjectId(dto.bookingId),
      dayId: day._id,
      linkedAt: new Date(),
    };
    // One atomic write: the day must still exist and the booking must not be
    // linked yet, so two requests at once cannot link it twice.
    const result = await this.itineraryModel
      .updateOne(
        {
          _id: doc._id,
          'days._id': day._id,
          bookingLinks: {
            $not: {
              $elemMatch: {
                bookingType: link.bookingType,
                bookingId: link.bookingId,
              },
            },
          },
        },
        { $push: { bookingLinks: link } },
      )
      .exec();
    if (result.matchedCount === 0) {
      const fresh = await this.itineraries.findOwnedOrThrow(user, itineraryId);
      findDayOrThrow(fresh, dto.dayId);
      throw new ConflictException(BOOKING_ALREADY_LINKED);
    }

    const index = doc.days.findIndex((d) => d._id.equals(day._id));
    return this.toView(link, doc, index, booking);
  }

  async list(
    user: AuthenticatedUser,
    itineraryId: string,
  ): Promise<BookingLinkDto[]> {
    const doc = await this.itineraries.findOwnedOrThrow(user, itineraryId);
    return this.viewsOf(doc);
  }

  async unlink(
    user: AuthenticatedUser,
    itineraryId: string,
    linkId: string,
  ): Promise<void> {
    const doc = await this.itineraries.findOwnedOrThrow(user, itineraryId);
    if (!OBJECT_ID.test(linkId)) {
      throw new NotFoundException(BOOKING_LINK_NOT_FOUND);
    }
    const oid = new Types.ObjectId(linkId);
    const result = await this.itineraryModel
      .updateOne(
        { _id: doc._id, 'bookingLinks._id': oid },
        { $pull: { bookingLinks: { _id: oid } } },
      )
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException(BOOKING_LINK_NOT_FOUND);
    }
  }

  /** The "linkedBookings" part of the owner's budget summary. */
  async summaryFor(doc: ItineraryDocument): Promise<LinkedBookingsSummaryDto> {
    const items = await this.viewsOf(doc);
    const total = items
      .filter((item) => item.countsInBudget && item.totalAmount !== null)
      .reduce(
        (sum, item) => sum.plus(new Decimal(item.totalAmount as string)),
        new Decimal(0),
      );
    return { currency: PLATFORM_CURRENCY, total: show(total), items };
  }

  /** Each link with its booking read live, in day order. */
  private async viewsOf(doc: ItineraryDocument): Promise<BookingLinkDto[]> {
    const links = doc.bookingLinks ?? [];
    const dayIndex = new Map(
      doc.days.map((d, i) => [d._id.toString(), i] as const),
    );
    const views = await Promise.all(
      links
        .filter((l) => dayIndex.has(l.dayId.toString()))
        .map(async (l) => {
          const booking = await this.readBooking(
            l.bookingType,
            l.bookingId.toString(),
          );
          // A booking that is no longer this user's is shown without details.
          const own =
            booking && booking.userId === doc.userId.toString()
              ? booking
              : null;
          return this.toView(
            l,
            doc,
            dayIndex.get(l.dayId.toString()) as number,
            own,
          );
        }),
    );
    return views.sort(
      (a, b) =>
        a.dayNumber - b.dayNumber ||
        a.linkedAt.getTime() - b.linkedAt.getTime(),
    );
  }

  /** The booking, or null when it cannot be read (deleted, or its module is off). */
  private async readBooking(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PayableBooking | null> {
    try {
      return await this.bookings.getPayableOrThrow(bookingType, bookingId);
    } catch (error) {
      if (
        error instanceof HttpException &&
        (error.getStatus() === HttpStatus.NOT_FOUND ||
          error.getStatus() === HttpStatus.NOT_IMPLEMENTED)
      ) {
        return null;
      }
      throw error;
    }
  }

  private toView(
    link: Pick<
      BookingLink,
      '_id' | 'bookingType' | 'bookingId' | 'dayId' | 'linkedAt'
    >,
    doc: ItineraryDocument,
    dayIndex: number,
    booking: PayableBooking | null,
  ): BookingLinkDto {
    const status = booking?.status ?? null;
    return {
      id: link._id.toString(),
      bookingType: link.bookingType,
      bookingId: link.bookingId.toString(),
      dayId: link.dayId.toString(),
      dayNumber: dayIndex + 1,
      date: dateOfDay(doc.startDate, dayIndex),
      city: doc.days[dayIndex].city,
      bookingReference: booking?.bookingReference ?? null,
      status,
      totalAmount: booking?.totalAmount ?? null,
      currency: booking?.currency ?? null,
      countsInBudget: status !== null && COUNTED_STATUSES.includes(status),
      linkedAt: link.linkedAt,
    };
  }
}
