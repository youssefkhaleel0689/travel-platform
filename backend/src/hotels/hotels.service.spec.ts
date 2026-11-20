import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { City } from '../common/reference-data/schemas/city.schema';
import { Country } from '../common/reference-data/schemas/country.schema';
import { MediaService } from '../media/media.service';
import { HotelsService } from './hotels.service';
import { HotelModeratorAssignment } from './schemas/hotel-moderator-assignment.schema';
import { Hotel } from './schemas/hotel.schema';

const HOTEL_ID = new Types.ObjectId().toHexString();

// A query stand-in: lean() resolves to the given rows.
function query<R>(result: R) {
  return { lean: () => Promise.resolve(result) };
}

// Only the assignment model matters here; the casts to Model are done only here.
function setup(moderatorIds: Types.ObjectId[]) {
  const assignmentModel = {
    find: jest.fn(() =>
      query(moderatorIds.map((moderatorId) => ({ moderatorId }))),
    ),
  };
  const service = new HotelsService(
    {} as unknown as Model<Hotel>,
    assignmentModel as unknown as Model<HotelModeratorAssignment>,
    {} as unknown as Model<City>,
    {} as unknown as Model<Country>,
    {} as unknown as MediaService,
  );
  return { service, assignmentModel };
}

describe('HotelsService.findModeratorIds (ACC-15)', () => {
  it('returns the ids of every moderator assigned to the hotel', async () => {
    const first = new Types.ObjectId();
    const second = new Types.ObjectId();
    const { service, assignmentModel } = setup([first, second]);

    const ids = await service.findModeratorIds(HOTEL_ID);

    expect(ids).toEqual([first.toHexString(), second.toHexString()]);
    expect(assignmentModel.find).toHaveBeenCalledWith(
      { hotelId: HOTEL_ID },
      { moderatorId: 1 },
    );
  });

  it('returns [] for a hotel without moderators', async () => {
    const { service } = setup([]);
    expect(await service.findModeratorIds(HOTEL_ID)).toEqual([]);
  });

  it('returns [] for a malformed id without querying', async () => {
    const { service, assignmentModel } = setup([]);
    expect(await service.findModeratorIds('not-an-id')).toEqual([]);
    expect(assignmentModel.find).not.toHaveBeenCalled();
  });
});
