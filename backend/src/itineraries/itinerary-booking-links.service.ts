import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { BookingStatus } from '../common/bookings/booking-status';
import { LinkBookingDto } from './dto/booking-link.dto';
import { ItinerariesService } from './itineraries.service';
import { BookingLink } from './schemas/itinerary.schema';
import { toItineraryView } from './itinerary.view';

@Injectable()
export class ItineraryBookingLinksService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly bookings: BookingsGateway,
  ) {}

  /** ITN-27: link one of your confirmed bookings to one day of your itinerary. */
  async link(
    user: AuthenticatedUser,
    itineraryId: string,
    dayId: string,
    dto: LinkBookingDto,
  ) {
    const itinerary = await this.itineraries.findOwnedOrThrow(user, itineraryId);
    const day = itinerary.days.find((d) => d._id.toString() === dayId);
    if (!day) {
      throw new NotFoundException({ code: 'DAY_NOT_FOUND', message: 'Day not found' });
    }

    const booking = await this.bookings.getPayableOrThrow(
      dto.bookingType,
      dto.bookingId,
    );

    // ACC-11: another account's booking is the same 404 as a missing one.
    if (booking.userId !== user.userId) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.COMPLETED
    ) {
      throw new ConflictException({
        code: 'BOOKING_NOT_CONFIRMED',
        message: 'Only a Confirmed or Completed booking can be linked',
      });
    }

    day.bookingLinks ??= [];
    // A booking feeds the budget once: linked to one day of the itinerary.
    const alreadyLinked = itinerary.days.some((d) =>
      (d.bookingLinks ?? []).some(
        (link) =>
          link.bookingType === dto.bookingType &&
          link.bookingId.toString() === dto.bookingId,
      ),
    );
    if (alreadyLinked) {
      throw new ConflictException({
        code: 'BOOKING_ALREADY_LINKED',
        message: 'This booking is already linked to a day',
      });
    }

    day.bookingLinks.push({
      _id: new Types.ObjectId(),
      bookingType: dto.bookingType,
      bookingId: new Types.ObjectId(dto.bookingId),
      amount: Types.Decimal128.fromString(booking.totalAmount),
      currency: booking.currency,
      reference: booking.bookingReference ?? undefined,
      label: dto.label?.trim() || undefined,
    } as BookingLink);

    itinerary.updatedAt = new Date();
    await itinerary.save();
    return toItineraryView(itinerary);
  }

  /** ITN-27: unlink without touching the booking itself. */
  async unlink(
    user: AuthenticatedUser,
    itineraryId: string,
    dayId: string,
    bookingType: string,
    bookingId: string,
  ) {
    const itinerary = await this.itineraries.findOwnedOrThrow(user, itineraryId);
    const day = itinerary.days.find((d) => d._id.toString() === dayId);
    if (!day) {
      throw new NotFoundException({ code: 'DAY_NOT_FOUND', message: 'Day not found' });
    }
    if (!Types.ObjectId.isValid(bookingId)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'Invalid booking id' });
    }
    const before = day.bookingLinks?.length ?? 0;
    day.bookingLinks = (day.bookingLinks ?? []).filter(
      (link) =>
        !(
          link.bookingType === bookingType &&
          link.bookingId.toString() === bookingId
        ),
    );
    if (day.bookingLinks.length === before) {
      throw new NotFoundException({ code: 'LINK_NOT_FOUND', message: 'Booking link not found' });
    }
    await itinerary.save();
    return toItineraryView(itinerary);
  }
}
