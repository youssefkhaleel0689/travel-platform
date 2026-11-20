import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { Role } from '../common/auth/auth.enums';
import { BookingStatus, BookingType } from '../common/bookings/booking-status';
import type { BookingsGateway } from '../common/bookings/bookings.gateway';
import type { ItinerariesService } from './itineraries.service';
import { ItineraryBookingLinksService } from './itinerary-booking-links.service';

const USER: AuthenticatedUser = {
  userId: new Types.ObjectId().toString(),
  role: Role.USER,
  sessionId: new Types.ObjectId().toString(),
};
const BOOKING_ID = new Types.ObjectId();
const DAY_1 = new Types.ObjectId();
const DAY_2 = new Types.ObjectId();

function itinerary(linkedOnDay1 = false) {
  const day = (id: Types.ObjectId, links: unknown[]) => ({
    _id: id,
    city: 'cairo',
    activities: [],
    budgetEntries: [],
    bookingLinks: links,
  });
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(USER.userId),
    title: 'Trip',
    countries: ['EG'],
    startDate: new Date('2099-05-10T00:00:00.000Z'),
    visibility: 'PRIVATE',
    transportCosts: [],
    days: [
      day(DAY_1, linkedOnDay1 ? [{ bookingType: BookingType.HOTEL, bookingId: BOOKING_ID }] : []),
      day(DAY_2, []),
    ],
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function setup(doc: ReturnType<typeof itinerary>, bookingUserId = USER.userId) {
  const itineraries = { findOwnedOrThrow: jest.fn().mockResolvedValue(doc) };
  const bookings = {
    getPayableOrThrow: jest.fn().mockResolvedValue({
      userId: bookingUserId,
      status: BookingStatus.CONFIRMED,
      totalAmount: '240.00',
      currency: 'USD',
      bookingReference: 'ABC234',
    }),
  };
  return new ItineraryBookingLinksService(
    itineraries as unknown as ItinerariesService,
    bookings as unknown as BookingsGateway,
  );
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { code: string }).code;
  }
  throw new Error('expected an error');
}

const dto = { bookingType: BookingType.HOTEL, bookingId: BOOKING_ID.toString() };

describe('ItineraryBookingLinksService (ITN-27)', () => {
  it("answers another account's booking with the same 404 as a missing one (ACC-11)", async () => {
    const service = setup(itinerary(), new Types.ObjectId().toString());
    expect(await codeOf(service.link(USER, 'x', DAY_1.toString(), dto))).toBe('BOOKING_NOT_FOUND');
  });

  it('links a booking only once in the whole itinerary', async () => {
    const service = setup(itinerary(true));
    expect(await codeOf(service.link(USER, 'x', DAY_2.toString(), dto))).toBe('BOOKING_ALREADY_LINKED');
  });

  it('links a confirmed booking with its price snapshot', async () => {
    const doc = itinerary();
    const service = setup(doc);
    await service.link(USER, 'x', DAY_1.toString(), dto);
    expect(doc.days[0].bookingLinks).toHaveLength(1);
    expect(doc.save).toHaveBeenCalled();
  });
});
