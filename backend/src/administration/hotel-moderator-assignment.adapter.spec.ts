import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HotelsService } from '../hotels/hotels.service';
import { HotelStatus } from '../hotels/schemas/hotel.schema';
import { HotelModeratorAssignmentAdapter } from './hotel-moderator-assignment.adapter';

describe('HotelModeratorAssignmentAdapter (ACC-13)', () => {
  const ADMIN_ID = '6720f1c2a1b2c3d4e5f60001';
  const MODERATOR_ID = '6720f1c2a1b2c3d4e5f60002';
  const HOTEL_ID = '6720f1c2a1b2c3d4e5f60888';

  let hotels: jest.Mocked<Pick<HotelsService, 'findById' | 'assignModerator'>>;
  let adapter: HotelModeratorAssignmentAdapter;

  function hotel(status = HotelStatus.ACTIVE) {
    return { id: HOTEL_ID, name: 'Nile View', status };
  }

  beforeEach(() => {
    hotels = {
      findById: jest.fn().mockResolvedValue(hotel()),
      assignModerator: jest.fn().mockResolvedValue({
        moderatorId: MODERATOR_ID,
        hotelId: HOTEL_ID,
        assignedAt: '2026-11-18T00:00:00.000Z',
      }),
    };
    adapter = new HotelModeratorAssignmentAdapter(
      hotels as unknown as HotelsService,
    );
  });

  it('accepts an active hotel', async () => {
    await expect(
      adapter.assertAssignable(HOTEL_ID, ADMIN_ID),
    ).resolves.toBeUndefined();
  });

  // As the admin, so a deactivated hotel is visible instead of 404.
  it('looks the hotel up as the acting admin', async () => {
    await adapter.assertAssignable(HOTEL_ID, ADMIN_ID);

    expect(hotels.findById).toHaveBeenCalledWith(HOTEL_ID, {
      id: ADMIN_ID,
      role: 'ADMIN',
    });
  });

  it('rejects a deactivated hotel with 400 PROVIDER_DEACTIVATED', async () => {
    hotels.findById.mockResolvedValue(hotel(HotelStatus.DEACTIVATED) as never);

    const result = adapter.assertAssignable(HOTEL_ID, ADMIN_ID);
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toMatchObject({
      response: { code: 'PROVIDER_DEACTIVATED' },
    });
  });

  it('lets the 404 for an unknown hotel through unchanged', async () => {
    const notFound = new NotFoundException({
      code: 'HOTEL_NOT_FOUND',
      message: 'Hotel not found',
    });
    hotels.findById.mockRejectedValue(notFound);

    await expect(adapter.assertAssignable(HOTEL_ID, ADMIN_ID)).rejects.toBe(
      notFound,
    );
  });

  it('assigns through HotelsService and returns nothing', async () => {
    await expect(
      adapter.assign(MODERATOR_ID, HOTEL_ID),
    ).resolves.toBeUndefined();

    expect(hotels.assignModerator).toHaveBeenCalledWith(MODERATOR_ID, HOTEL_ID);
  });
});
