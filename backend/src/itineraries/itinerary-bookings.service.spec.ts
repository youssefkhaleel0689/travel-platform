import {
  ConflictException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from '../common/bookings/booking-status';
import type { BookingsGateway } from '../common/bookings/bookings.gateway';
import type { PayableBooking } from '../common/bookings/bookings.port';
import type { ItinerariesService } from './itineraries.service';
import { ItineraryBookingsService } from './itinerary-bookings.service';
import type { Itinerary, ItineraryDocument } from './schemas/itinerary.schema';

const ownerId = new Types.ObjectId();
const user = { userId: ownerId.toString() } as AuthenticatedUser;
const dayIds = [new Types.ObjectId(), new Types.ObjectId()];

function booking(
  status: BookingStatus,
  totalAmount: string,
  userId = ownerId.toString(),
): PayableBooking {
  return {
    bookingId: new Types.ObjectId().toString(),
    bookingType: BookingType.HOTEL,
    userId,
    status,
    totalAmount,
    currency: 'USD',
    holdExpiresAt: null,
    bookingReference: 'REF-1',
    providerType: ProviderType.HOTEL,
    providerId: new Types.ObjectId().toString(),
  };
}

function setup(
  links: { bookingId: Types.ObjectId; dayId: Types.ObjectId }[],
  read: (id: string) => Promise<PayableBooking>,
  matchedCount = 1,
) {
  const doc = {
    _id: new Types.ObjectId(),
    userId: ownerId,
    startDate: new Date('2027-03-10'),
    days: dayIds.map((_id) => ({ _id, city: 'paris' })),
    bookingLinks: links.map((l, i) => ({
      _id: new Types.ObjectId(),
      bookingType: BookingType.HOTEL,
      linkedAt: new Date(1000 + i),
      ...l,
    })),
  } as unknown as ItineraryDocument;
  const updateOne = jest.fn().mockReturnValue({
    exec: () => Promise.resolve({ matchedCount }),
  });
  const service = new ItineraryBookingsService(
    { updateOne } as unknown as Model<Itinerary>,
    {
      findOwnedOrThrow: jest.fn().mockResolvedValue(doc),
    } as unknown as ItinerariesService,
    {
      getPayableOrThrow: jest.fn((_type: BookingType, id: string) => read(id)),
    } as unknown as BookingsGateway,
  );
  return { service, doc, updateOne };
}

const linkDto = (bookingId: string) => ({
  bookingType: BookingType.HOTEL,
  bookingId,
  dayId: dayIds[0].toString(),
});

describe('ItineraryBookingsService (ITN-27)', () => {
  it('links a confirmed booking of the owner', async () => {
    const b = booking(BookingStatus.CONFIRMED, '120.00');
    const { service, updateOne } = setup([], () => Promise.resolve(b));
    const view = await service.link(user, 'id', linkDto(b.bookingId));
    expect(view).toEqual(
      expect.objectContaining({
        dayNumber: 1,
        date: '2027-03-10',
        totalAmount: '120.00',
        countsInBudget: true,
      }),
    );
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it("refuses someone else's, an unpaid and an already linked booking", async () => {
    const theirs = booking(BookingStatus.CONFIRMED, '1.00', 'someone-else');
    await expect(
      setup([], () => Promise.resolve(theirs)).service.link(
        user,
        'id',
        linkDto(theirs.bookingId),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const unpaid = booking(BookingStatus.PENDING_PAYMENT, '1.00');
    await expect(
      setup([], () => Promise.resolve(unpaid)).service.link(
        user,
        'id',
        linkDto(unpaid.bookingId),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const ok = booking(BookingStatus.CONFIRMED, '1.00');
    await expect(
      setup([], () => Promise.resolve(ok), 0).service.link(
        user,
        'id',
        linkDto(ok.bookingId),
      ),
    ).rejects.toMatchObject({ response: { code: 'BOOKING_ALREADY_LINKED' } });
  });

  it('totals only the bookings that still count, in day order', async () => {
    const counted = booking(BookingStatus.COMPLETED, '200.10');
    const cancelled = booking(BookingStatus.CANCELLED, '999.00');
    const byId = new Map([
      [counted.bookingId, counted],
      [cancelled.bookingId, cancelled],
    ]);
    const { service, doc } = setup(
      [
        {
          bookingId: new Types.ObjectId(cancelled.bookingId),
          dayId: dayIds[1],
        },
        { bookingId: new Types.ObjectId(counted.bookingId), dayId: dayIds[0] },
      ],
      (id) => Promise.resolve(byId.get(id)!),
    );
    const summary = await service.summaryFor(doc);
    expect(summary.currency).toBe('USD');
    expect(summary.total).toBe('200.10');
    expect(summary.items.map((i) => i.dayNumber)).toEqual([1, 2]);
    expect(summary.items[1]).toEqual(
      expect.objectContaining({ status: 'CANCELLED', countsInBudget: false }),
    );
  });

  it('shows a booking that cannot be read without details, and does not count it', async () => {
    const { service, doc } = setup(
      [{ bookingId: new Types.ObjectId(), dayId: dayIds[0] }],
      () => Promise.reject(new NotImplementedException()),
    );
    const summary = await service.summaryFor(doc);
    expect(summary.total).toBe('0.00');
    expect(summary.items[0]).toEqual(
      expect.objectContaining({
        status: null,
        totalAmount: null,
        countsInBudget: false,
      }),
    );
  });
});
