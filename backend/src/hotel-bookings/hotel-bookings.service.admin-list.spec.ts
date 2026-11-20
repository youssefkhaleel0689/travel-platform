import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import { BookingType, ProviderType } from '../common/bookings/booking-status';
import { HotelPoliciesService } from '../hotel-policies/hotel-policies.service';
import { HotelsService } from '../hotels/hotels.service';
import { InventoryService } from '../inventory/inventory.service';
import { RoomDocument } from '../rooms/schemas/room.schema';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  HotelBookingDocument,
  HotelBookingStatus,
} from './schemas/hotel-booking.schema';

// ACC-17, the hotel half of BookingsPort.listForAdmin. Only the booking model
// and HotelsService.briefs matter here; the casts are done only here.
function setup(
  rows: Record<string, unknown>[],
  total: number,
  names: Record<string, string>,
) {
  type Chain = {
    sort: jest.Mock<Chain>;
    limit: jest.Mock<Chain>;
    lean: jest.Mock<Chain>;
    exec: jest.Mock<Promise<Record<string, unknown>[]>>;
  };
  const chain: Chain = {
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(() => chain),
    exec: jest.fn(() => Promise.resolve(rows)),
  };
  const bookingModel = {
    find: jest.fn(() => chain),
    countDocuments: jest.fn(() => ({ exec: () => Promise.resolve(total) })),
    updateOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const hotels = {
    briefs: jest.fn(() =>
      Promise.resolve(
        new Map(Object.entries(names).map(([id, name]) => [id, { id, name }])),
      ),
    ),
  };
  const service = new HotelBookingsService(
    bookingModel as unknown as Model<HotelBookingDocument>,
    {} as unknown as Model<RoomDocument>,
    {} as unknown as Connection,
    {} as unknown as InventoryService,
    {} as unknown as HotelPoliciesService,
    hotels as unknown as HotelsService,
    {} as unknown as UsersService,
  );
  return { service, bookingModel, chain, hotels };
}

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    bookingReference: 'HTL-8F2A19C04B',
    userId: new Types.ObjectId(),
    hotelId: new Types.ObjectId(),
    checkInDate: new Date('2027-02-01T00:00:00Z'),
    checkOutDate: new Date('2027-02-03T00:00:00Z'),
    totalPrice: Types.Decimal128.fromString('240.00'),
    currency: 'USD',
    status: HotelBookingStatus.CONFIRMED,
    createdAt: new Date('2026-11-20T08:00:00Z'),
    ...overrides,
  };
}

describe('HotelBookingsService.listForAdminPort (ACC-17)', () => {
  it('maps a reservation to an admin row: stay dates, the amount as a string, the hotel name', async () => {
    const r = reservation();
    const { service } = setup([r], 1, {
      [String(r.hotelId)]: 'Nile View Hotel',
    });

    const list = await service.listForAdminPort({ limit: 10 });

    expect(list.total).toBe(1);
    expect(list.rows).toEqual([
      {
        bookingId: String(r._id),
        bookingType: BookingType.HOTEL,
        bookingReference: 'HTL-8F2A19C04B',
        userId: String(r.userId),
        providerType: ProviderType.HOTEL,
        providerId: String(r.hotelId),
        providerName: 'Nile View Hotel',
        startsAt: r.checkInDate,
        endsAt: r.checkOutDate,
        totalAmount: '240.00',
        currency: 'USD',
        status: HotelBookingStatus.CONFIRMED,
        createdAt: r.createdAt,
      },
    ]);
  });

  it('applies the filter to the rows and the count alike, newest first with the id as tie-break', async () => {
    const { service, bookingModel, chain } = setup([], 0, {});
    const from = new Date('2026-11-01T00:00:00Z');
    const to = new Date('2026-12-01T00:00:00Z');

    await service.listForAdminPort({
      status: HotelBookingStatus.CANCELLED,
      reference: 'HTL-8F2A19C04B',
      createdFrom: from,
      createdTo: to,
      limit: 20,
    });

    const expected = {
      status: HotelBookingStatus.CANCELLED,
      bookingReference: 'HTL-8F2A19C04B',
      createdAt: { $gte: from, $lt: to },
    };
    expect(bookingModel.find).toHaveBeenCalledWith(expected);
    expect(bookingModel.countDocuments).toHaveBeenCalledWith(expected);
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it('is never filtered by user, and an empty filter matches everything', async () => {
    const { service, bookingModel } = setup([], 0, {});

    await service.listForAdminPort({ limit: 10 });

    expect(bookingModel.find).toHaveBeenCalledWith({});
    expect(bookingModel.countDocuments).toHaveBeenCalledWith({});
  });

  it('still lists a reservation whose hotel has gone, with a null name', async () => {
    const { service } = setup(
      [reservation({ bookingReference: undefined })],
      1,
      {},
    );

    const [row] = (await service.listForAdminPort({ limit: 10 })).rows;

    expect(row.providerName).toBeNull();
    expect(row.bookingReference).toBeNull();
  });

  it('only reads: no booking is changed', async () => {
    const { service, bookingModel } = setup([reservation()], 1, {});

    await service.listForAdminPort({ limit: 10 });

    expect(bookingModel.updateOne).not.toHaveBeenCalled();
    expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
