import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { City } from '../common/reference-data/schemas/city.schema';
import { Country } from '../common/reference-data/schemas/country.schema';
import { MediaService } from '../media/media.service';
import { HotelsService } from './hotels.service';
import { HotelModeratorAssignment } from './schemas/hotel-moderator-assignment.schema';
import { Hotel, HotelStatus } from './schemas/hotel.schema';

const HOTEL_ID = new Types.ObjectId();
const LEGACY_ID = new Types.ObjectId();
const NEW_ID = new Types.ObjectId();

// GEN-08: photos uploaded before MediaService held hotel photos only have a
// storageKey; they must keep working after the move.
function setup() {
  const hotel = {
    _id: HOTEL_ID,
    status: HotelStatus.ACTIVE,
    photos: [
      {
        _id: LEGACY_ID,
        url: `/api/hotels/${HOTEL_ID.toHexString()}/photos/${LEGACY_ID.toHexString()}`,
        storageKey: `hotels/${HOTEL_ID.toHexString()}/old.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 10,
      },
      {
        _id: NEW_ID,
        url: `/api/hotels/${HOTEL_ID.toHexString()}/photos/${NEW_ID.toHexString()}`,
        mimeType: 'image/png',
        sizeBytes: 20,
      },
    ],
  };
  const hotelModel = {
    findById: jest.fn(() => ({ lean: () => Promise.resolve(hotel) })),
  };
  const media = {
    openStoredFile: jest.fn(() =>
      Promise.resolve({
        path: '/u/old.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
      }),
    ),
    openForTarget: jest.fn(() =>
      Promise.resolve({
        path: '/u/new.png',
        mimeType: 'image/png',
        sizeBytes: 20,
      }),
    ),
  };
  const service = new HotelsService(
    hotelModel as unknown as Model<Hotel>,
    {} as unknown as Model<HotelModeratorAssignment>,
    {} as unknown as Model<City>,
    {} as unknown as Model<Country>,
    media as unknown as MediaService,
  );
  return { service, media };
}

describe('HotelsService.getPhotoFile with photos from before MediaService (GEN-08)', () => {
  it('serves an older photo by its storageKey', async () => {
    const { service, media } = setup();

    const file = await service.getPhotoFile(
      HOTEL_ID.toHexString(),
      LEGACY_ID.toHexString(),
    );

    expect(file.path).toBe('/u/old.jpg');
    expect(media.openStoredFile).toHaveBeenCalledWith(
      `hotels/${HOTEL_ID.toHexString()}/old.jpg`,
      'image/jpeg',
      10,
    );
    expect(media.openForTarget).not.toHaveBeenCalled();
  });

  it('serves a newer photo through its media row', async () => {
    const { service, media } = setup();

    const file = await service.getPhotoFile(
      HOTEL_ID.toHexString(),
      NEW_ID.toHexString(),
    );

    expect(file.path).toBe('/u/new.png');
    expect(media.openStoredFile).not.toHaveBeenCalled();
  });
});
