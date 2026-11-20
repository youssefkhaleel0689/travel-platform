import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import { todayUtc } from '../common/dates';
import { HotelPoliciesService } from '../hotel-policies/hotel-policies.service';
import { HotelsService } from '../hotels/hotels.service';
import { InventoryService } from '../inventory/inventory.service';
import { RoomDocument } from '../rooms/schemas/room.schema';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  HotelBookingDocument,
  HotelBookingStatus,
} from './schemas/hotel-booking.schema';

const HOTEL_ID = new Types.ObjectId().toHexString();

// Only the booking model matters here; the casts are done only here.
function setup(userIds: Types.ObjectId[]) {
  const bookingModel = {
    distinct: jest.fn(() => ({ exec: () => Promise.resolve(userIds) })),
    updateOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const service = new HotelBookingsService(
    bookingModel as unknown as Model<HotelBookingDocument>,
    {} as unknown as Model<RoomDocument>,
    {} as unknown as Connection,
    {} as unknown as InventoryService,
    {} as unknown as HotelPoliciesService,
    {} as unknown as HotelsService,
    {} as unknown as UsersService,
  );
  return { service, bookingModel };
}

describe('HotelBookingsService.findUserIdsWithUpcomingConfirmedStays (ACC-15)', () => {
  it('returns the distinct users with a CONFIRMED stay that has not checked out yet', async () => {
    const first = new Types.ObjectId();
    const second = new Types.ObjectId();
    const { service, bookingModel } = setup([first, second]);

    const ids = await service.findUserIdsWithUpcomingConfirmedStays(HOTEL_ID);

    expect(ids).toEqual([first.toHexString(), second.toHexString()]);
    expect(bookingModel.distinct).toHaveBeenCalledWith('userId', {
      hotelId: new Types.ObjectId(HOTEL_ID),
      status: HotelBookingStatus.CONFIRMED,
      checkOutDate: { $gte: todayUtc() },
    });
  });

  it('only reads: no booking is changed (confirmed bookings remain valid)', async () => {
    const { service, bookingModel } = setup([]);

    expect(
      await service.findUserIdsWithUpcomingConfirmedStays(HOTEL_ID),
    ).toEqual([]);
    expect(bookingModel.updateOne).not.toHaveBeenCalled();
    expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
