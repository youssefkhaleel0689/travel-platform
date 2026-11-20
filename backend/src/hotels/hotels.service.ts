import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { ClientSession, Model, UpdateQuery } from 'mongoose';
import { Types } from 'mongoose';
import { PageDto } from '../common/pagination/dto/page.dto';
import { LeanDoc, paginateQuery } from '../common/pagination/paginate';
import { City } from '../common/reference-data/schemas/city.schema';
import { Country } from '../common/reference-data/schemas/country.schema';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CreateHotelDto, HotelResponseDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { HotelModeratorAssignment } from './schemas/hotel-moderator-assignment.schema';
import {
  Hotel,
  HOTEL_MAX_PHOTOS,
  HOTEL_PHOTO_MAX_BYTES,
  HotelPhoto,
  HotelPhotoMimeType,
  HotelStatus,
} from './schemas/hotel.schema';

// Roles that matter to this module (schema section 6, role enum).
export const ROLE_ADMIN = 'ADMIN';
export const ROLE_HOTEL_MODERATOR = 'HOTEL_MODERATOR';

// The authenticated caller, as placed on req.user by the auth guard (C2).
// The guard is responsible for rejecting suspended / deactivated accounts and
// expired sessions; this module checks role and hotel assignment (ACC-11).
export interface HotelActor {
  id: string;
  role: string;
}

// The parts of an uploaded file this module needs (multer memory storage).
export interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type HotelLean = LeanDoc<Hotel>;

/**
 * The hotel fields the hotel side (rooms, availability, policies, search,
 * reservations, reviews) reads. They get it through this service, never
 * through the Hotel model (README module conventions).
 */
export interface HotelBrief {
  _id: Types.ObjectId;
  name: string;
  status: HotelStatus;
  cityId: string;
  countryId: string;
  address: string;
  starClass: number;
  photos: HotelPhoto[];
  ratingAverage: number | null;
  ratingCount: number;
}

const PHOTO_EXTENSION: Record<HotelPhotoMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

@Injectable()
export class HotelsService {
  private readonly uploadsRoot: string;

  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectModel(HotelModeratorAssignment.name)
    private readonly assignmentModel: Model<HotelModeratorAssignment>,
    @InjectModel(City.name) private readonly cityModel: Model<City>,
    @InjectModel(Country.name) private readonly countryModel: Model<Country>,
    config: ConfigService,
  ) {
    this.uploadsRoot = resolve(config.get<string>('UPLOADS_DIR') ?? 'uploads');
  }

  // ------------------------------------------------------------------
  // Hotel profile (HTL-01, HTL-02)
  // ------------------------------------------------------------------

  // HTL-01: an admin creates a hotel profile.
  async create(
    dto: CreateHotelDto,
    actor: HotelActor,
  ): Promise<HotelResponseDto> {
    this.assertAdmin(actor);
    await this.assertCityInCountry(dto.cityId, dto.countryId);

    const hotel = await this.hotelModel.create({
      name: dto.name,
      address: dto.address,
      cityId: dto.cityId,
      countryId: dto.countryId,
      description: dto.description ?? '',
      starClass: dto.starClass,
      amenities: dto.amenities ?? [],
      createdBy: new Types.ObjectId(actor.id),
    });
    return this.toResponse(hotel.toObject());
  }

  // Admin dashboard: every hotel, newest first, page size 10 (GEN-05).
  async list(
    page: number,
    actor: HotelActor,
  ): Promise<PageDto<HotelResponseDto>> {
    this.assertAdmin(actor);
    const result = await paginateQuery(
      this.hotelModel,
      {},
      { page, sort: { createdAt: -1 } },
    );
    return new PageDto(
      result.items.map((hotel) => this.toResponse(hotel)),
      result.meta,
    );
  }

  // HTL-02 (profile part): public. A DEACTIVATED hotel is hidden (404) from
  // everybody except admins and its assigned moderators.
  async findById(
    hotelId: string,
    actor?: HotelActor,
  ): Promise<HotelResponseDto> {
    const hotel = await this.hotelModel.findById(hotelId).lean<HotelLean>();
    if (!hotel) throw this.hotelNotFound();

    if (
      hotel.status !== HotelStatus.ACTIVE &&
      !(await this.canManage(actor, hotelId))
    ) {
      throw this.hotelNotFound();
    }
    return this.toResponse(hotel);
  }

  // HTL-01: the assigned hotel moderator edits the hotel profile.
  async update(
    hotelId: string,
    dto: UpdateHotelDto,
    actor: HotelActor,
  ): Promise<HotelResponseDto> {
    await this.assertModeratorOwnsHotel(actor, hotelId);

    const nullFields = Object.entries(dto)
      .filter(([, value]) => value === null)
      .map(([field]) => field);
    if (nullFields.length) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        errors: nullFields.map((field) => ({
          field,
          messages: [`${field} must not be null`],
        })),
      });
    }

    const current = await this.hotelModel.findById(hotelId).lean<HotelLean>();
    if (!current) throw this.hotelNotFound();

    if (dto.cityId !== undefined || dto.countryId !== undefined) {
      await this.assertCityInCountry(
        dto.cityId ?? current.cityId,
        dto.countryId ?? current.countryId,
      );
    }

    const set: Partial<Hotel> = {};
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.address !== undefined) set.address = dto.address;
    if (dto.cityId !== undefined) set.cityId = dto.cityId;
    if (dto.countryId !== undefined) set.countryId = dto.countryId;
    if (dto.description !== undefined) set.description = dto.description;
    if (dto.starClass !== undefined) set.starClass = dto.starClass;
    if (dto.amenities !== undefined) set.amenities = dto.amenities;

    if (Object.keys(set).length === 0) return this.toResponse(current);

    const updated = await this.hotelModel
      .findByIdAndUpdate(
        hotelId,
        { $set: set },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<HotelLean>();
    if (!updated) throw this.hotelNotFound();
    return this.toResponse(updated);
  }

  // ------------------------------------------------------------------
  // Hotel photos (HTL-01, GEN-08)
  // ------------------------------------------------------------------

  // Stores one JPG/PNG (<= 5 MB) on the server; at most 5 photos per hotel.
  async addPhoto(
    hotelId: string,
    file: UploadedImageFile | undefined,
    actor: HotelActor,
  ): Promise<HotelResponseDto> {
    await this.assertModeratorOwnsHotel(actor, hotelId);
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'A photo file is required',
        errors: [{ field: 'file', messages: ['file is required'] }],
      });
    }

    const mimeType = this.detectImageType(file.buffer);
    if (!mimeType) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'Only JPG and PNG images are accepted',
        errors: [{ field: 'file', messages: ['must be a JPG or PNG image'] }],
      });
    }
    if (
      file.size > HOTEL_PHOTO_MAX_BYTES ||
      file.buffer.length > HOTEL_PHOTO_MAX_BYTES
    ) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'Images must be at most 5 MB',
        errors: [{ field: 'file', messages: ['must be at most 5 MB'] }],
      });
    }

    const hotel = await this.hotelModel.findById(hotelId).lean<HotelLean>();
    if (!hotel) throw this.hotelNotFound();
    if (hotel.photos.length >= HOTEL_MAX_PHOTOS) throw this.photoLimitReached();

    const photoId = new Types.ObjectId();
    const storageKey = `hotels/${hotelId}/${randomUUID()}.${PHOTO_EXTENSION[mimeType]}`;
    const absolutePath = this.resolveStoragePath(storageKey);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer);

    const photo: HotelPhoto = {
      _id: photoId,
      url: `/api/hotels/${hotelId}/photos/${photoId.toHexString()}`,
      storageKey,
      mimeType,
      sizeBytes: file.buffer.length,
    };

    // Conditional push: two concurrent uploads can never exceed the limit.
    const updated = await this.hotelModel
      .findOneAndUpdate(
        {
          _id: hotelId,
          [`photos.${HOTEL_MAX_PHOTOS - 1}`]: { $exists: false },
        },
        { $push: { photos: photo } } as UpdateQuery<Hotel>,
        { returnDocument: 'after' },
      )
      .lean<HotelLean>();

    if (!updated) {
      await this.removeStoredFile(storageKey);
      throw this.photoLimitReached();
    }
    return this.toResponse(updated);
  }

  async removePhoto(
    hotelId: string,
    photoId: string,
    actor: HotelActor,
  ): Promise<HotelResponseDto> {
    await this.assertModeratorOwnsHotel(actor, hotelId);

    const hotel = await this.hotelModel.findById(hotelId).lean<HotelLean>();
    if (!hotel) throw this.hotelNotFound();
    const photo = hotel.photos.find((p) => p._id.equals(photoId));
    if (!photo) throw this.photoNotFound();

    const updated = await this.hotelModel
      .findByIdAndUpdate(
        hotelId,
        { $pull: { photos: { _id: photo._id } } } as UpdateQuery<Hotel>,
        { returnDocument: 'after' },
      )
      .lean<HotelLean>();
    if (!updated) throw this.hotelNotFound();

    await this.removeStoredFile(photo.storageKey);
    return this.toResponse(updated);
  }

  // Serves a stored photo by URL (GEN-08). Photos of a DEACTIVATED hotel are
  // hidden like the hotel itself.
  async getPhotoFile(
    hotelId: string,
    photoId: string,
    actor?: HotelActor,
  ): Promise<{
    path: string;
    mimeType: HotelPhotoMimeType;
    sizeBytes: number;
  }> {
    const hotel = await this.hotelModel.findById(hotelId).lean<HotelLean>();
    if (!hotel) throw this.photoNotFound();
    if (
      hotel.status !== HotelStatus.ACTIVE &&
      !(await this.canManage(actor, hotelId))
    ) {
      throw this.photoNotFound();
    }

    const photo = hotel.photos.find((p) => p._id.equals(photoId));
    if (!photo) throw this.photoNotFound();

    const path = this.resolveStoragePath(photo.storageKey);
    try {
      await stat(path);
    } catch {
      throw this.photoNotFound();
    }
    return { path, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes };
  }

  // ------------------------------------------------------------------
  // Provider status (ACC-15). Called by the admin module (C2) from
  // PATCH /api/admin/providers/hotel/:id/deactivate|reactivate, which also
  // writes the audit log (GEN-07) and sends the notifications.
  // ------------------------------------------------------------------

  async deactivate(hotelId: string): Promise<HotelResponseDto> {
    const updated = await this.hotelModel
      .findOneAndUpdate(
        { _id: hotelId, status: HotelStatus.ACTIVE },
        {
          $set: { status: HotelStatus.DEACTIVATED, deactivatedAt: new Date() },
        },
        { returnDocument: 'after' },
      )
      .lean<HotelLean>();
    if (updated) return this.toResponse(updated);

    await this.findExistingOrThrow(hotelId);
    throw new ConflictException({
      code: 'HOTEL_ALREADY_DEACTIVATED',
      message: 'Hotel is already deactivated',
    });
  }

  async reactivate(hotelId: string): Promise<HotelResponseDto> {
    const updated = await this.hotelModel
      .findOneAndUpdate(
        { _id: hotelId, status: HotelStatus.DEACTIVATED },
        { $set: { status: HotelStatus.ACTIVE, deactivatedAt: null } },
        { returnDocument: 'after' },
      )
      .lean<HotelLean>();
    if (updated) return this.toResponse(updated);

    await this.findExistingOrThrow(hotelId);
    throw new ConflictException({
      code: 'HOTEL_ALREADY_ACTIVE',
      message: 'Hotel is already active',
    });
  }

  // ------------------------------------------------------------------
  // Moderator assignment (hotelModeratorAssignment). Used by ACC-13
  // (POST /api/admin/moderators, C2) and by every moderator route (B2).
  // ------------------------------------------------------------------

  // Links a HOTEL_MODERATOR account to exactly one hotel. Pass the session
  // when the moderator account is created in the same transaction.
  async assignModerator(
    moderatorId: string,
    hotelId: string,
    session?: ClientSession,
  ): Promise<{ moderatorId: string; hotelId: string; assignedAt: string }> {
    const hotelExists = await this.hotelModel
      .exists({ _id: hotelId })
      .session(session ?? null);
    if (!hotelExists) throw this.hotelNotFound();

    const existing = await this.assignmentModel
      .exists({ moderatorId })
      .session(session ?? null);
    if (existing) {
      throw new ConflictException({
        code: 'MODERATOR_ALREADY_ASSIGNED',
        message: 'This moderator is already assigned to a hotel',
      });
    }

    // The unique index on moderatorId also guards against concurrent calls.
    const [assignment] = await this.assignmentModel.create(
      [
        {
          moderatorId: new Types.ObjectId(moderatorId),
          hotelId: new Types.ObjectId(hotelId),
          assignedAt: new Date(),
        },
      ],
      { session },
    );
    return {
      moderatorId: assignment.moderatorId.toHexString(),
      hotelId: assignment.hotelId.toHexString(),
      assignedAt: assignment.assignedAt.toISOString(),
    };
  }

  async removeModeratorAssignment(
    moderatorId: string,
    session?: ClientSession,
  ): Promise<void> {
    await this.assignmentModel.deleteOne({ moderatorId }, { session });
  }

  // The hotel a moderator manages, or null if none is assigned.
  async getAssignedHotelId(moderatorId: string): Promise<string | null> {
    const assignment = await this.assignmentModel
      .findOne({ moderatorId })
      .lean<LeanDoc<HotelModeratorAssignment>>();
    return assignment ? assignment.hotelId.toHexString() : null;
  }

  // ACC-15: the user ids of every moderator assigned to this hotel, so the
  // admin module can notify them. Read-only; a malformed id has none.
  async findModeratorIds(hotelId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(hotelId)) return [];
    const rows = await this.assignmentModel
      .find({ hotelId }, { moderatorId: 1 })
      .lean<Pick<HotelModeratorAssignment, 'moderatorId'>[]>();
    return rows.map((row) => row.moderatorId.toHexString());
  }

  // Throws 403 unless the caller is a HOTEL_MODERATOR assigned to this hotel,
  // and 404 if the hotel does not exist (ACC-11). Reuse it in every moderator
  // route: rooms, availability, policies, reservations (B2).
  async assertModeratorOwnsHotel(
    actor: HotelActor,
    hotelId: string,
  ): Promise<void> {
    if (actor.role !== ROLE_HOTEL_MODERATOR) {
      throw new ForbiddenException({
        code: 'HOTEL_MODERATOR_ONLY',
        message: 'Only the assigned hotel moderator can do this',
      });
    }
    await this.findExistingOrThrow(hotelId);
    if (!(await this.isAssigned(actor.id, hotelId))) {
      throw new ForbiddenException({
        code: 'HOTEL_NOT_ASSIGNED',
        message: 'You are not assigned to this hotel',
      });
    }
  }

  // ------------------------------------------------------------------
  // Helpers for the hotel side (B2): search, booking and reviews.
  // ------------------------------------------------------------------

  // An ACTIVE hotel as a HotelBrief, or 404 HOTEL_NOT_FOUND (a deactivated
  // hotel cannot be searched, booked or reviewed, ACC-15).
  async getActiveHotelOrThrow(hotelId: string): Promise<HotelBrief> {
    if (!Types.ObjectId.isValid(hotelId)) throw this.hotelNotFound();
    const hotel = await this.hotelModel
      .findOne({ _id: hotelId, status: HotelStatus.ACTIVE })
      .lean<HotelBrief>();
    if (!hotel) throw this.hotelNotFound();
    return hotel;
  }

  // Moderator routes of the hotel side: the caller must be the HOTEL_MODERATOR
  // assigned to this hotel (same rule and codes as assertModeratorOwnsHotel).
  // With allowAdmin, an ADMIN passes too (read-only dashboards). A deactivated
  // hotel stays manageable. Returns the hotel so callers need no second read.
  async assertManagesHotel(
    user: AuthenticatedUser,
    hotelId: string,
    allowAdmin = false,
  ): Promise<HotelBrief> {
    if (!Types.ObjectId.isValid(hotelId)) throw this.hotelNotFound();
    const hotel = await this.hotelModel.findById(hotelId).lean<HotelBrief>();
    if (!hotel) throw this.hotelNotFound();
    if (allowAdmin && user.role === ROLE_ADMIN) return hotel;
    await this.assertModeratorOwnsHotel(
      { id: user.userId, role: user.role },
      hotelId,
    );
    return hotel;
  }

  // HTL-11: ACTIVE hotels in any of the searched seeded cities or countries.
  async findActiveByCityOrCountry(
    cityIds: string[],
    countryIds: string[],
  ): Promise<HotelBrief[]> {
    if (!cityIds.length && !countryIds.length) return [];
    return this.hotelModel
      .find({
        status: HotelStatus.ACTIVE,
        $or: [
          ...(cityIds.length ? [{ cityId: { $in: cityIds } }] : []),
          ...(countryIds.length ? [{ countryId: { $in: countryIds } }] : []),
        ],
      })
      .lean<HotelBrief[]>();
  }

  // Hotel name, address and place for lists of reservations, keyed by id.
  async briefs(ids: Types.ObjectId[]): Promise<Map<string, HotelBrief>> {
    if (!ids.length) return new Map();
    const rows = await this.hotelModel
      .find({ _id: { $in: ids } })
      .lean<HotelBrief[]>();
    return new Map(rows.map((row) => [String(row._id), row]));
  }

  // A hotel that can be searched and booked: exists and is ACTIVE (ACC-15).
  async getBookableHotel(hotelId: string): Promise<HotelResponseDto> {
    const hotel = await this.hotelModel
      .findOne({ _id: hotelId, status: HotelStatus.ACTIVE })
      .lean<HotelLean>();
    if (!hotel) throw this.hotelNotFound();
    return this.toResponse(hotel);
  }

  // reviewAggregate: B2 recalculates from VISIBLE reviews after every review
  // create / edit / delete / hide and stores the result here.
  async setRatingAggregate(
    hotelId: string,
    ratingAverage: number | null,
    ratingCount: number,
    session?: ClientSession,
  ): Promise<void> {
    const result = await this.hotelModel.updateOne(
      { _id: hotelId },
      {
        $set: {
          ratingAverage: ratingCount > 0 ? ratingAverage : null,
          ratingCount,
        },
      },
      { session, runValidators: true },
    );
    if (result.matchedCount === 0) throw this.hotelNotFound();
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  toResponse(hotel: HotelLean): HotelResponseDto {
    return {
      id: hotel._id.toHexString(),
      name: hotel.name,
      address: hotel.address,
      cityId: hotel.cityId,
      countryId: hotel.countryId,
      description: hotel.description ?? '',
      starClass: hotel.starClass,
      status: hotel.status,
      deactivatedAt: hotel.deactivatedAt
        ? new Date(hotel.deactivatedAt).toISOString()
        : null,
      ratingAverage: hotel.ratingAverage ?? null,
      ratingCount: hotel.ratingCount ?? 0,
      photos: (hotel.photos ?? []).map((photo) => ({
        id: photo._id.toHexString(),
        url: photo.url,
        mimeType: photo.mimeType,
        sizeBytes: photo.sizeBytes,
      })),
      amenities: hotel.amenities ?? [],
      createdAt: new Date(hotel.createdAt).toISOString(),
      updatedAt: new Date(hotel.updatedAt).toISOString(),
    };
  }

  private assertAdmin(actor: HotelActor): void {
    if (actor.role !== ROLE_ADMIN) {
      throw new ForbiddenException({
        code: 'ADMIN_ONLY',
        message: 'Only an admin can do this',
      });
    }
  }

  // Admins, and the moderators assigned to this hotel.
  private async canManage(
    actor: HotelActor | undefined,
    hotelId: string,
  ): Promise<boolean> {
    if (!actor) return false;
    if (actor.role === ROLE_ADMIN) return true;
    return (
      actor.role === ROLE_HOTEL_MODERATOR &&
      (await this.isAssigned(actor.id, hotelId))
    );
  }

  private async isAssigned(
    moderatorId: string,
    hotelId: string,
  ): Promise<boolean> {
    if (
      !Types.ObjectId.isValid(moderatorId) ||
      !Types.ObjectId.isValid(hotelId)
    ) {
      return false;
    }
    // moderatorId and hotelId are SchemaTypes.ObjectId paths, so the string ids cast.
    const found = await this.assignmentModel.exists({ moderatorId, hotelId });
    return found !== null;
  }

  // cityId and countryId must be seeded, and the city must be in the country.
  private async assertCityInCountry(
    cityId: string,
    countryId: string,
  ): Promise<void> {
    const [city, country] = await Promise.all([
      this.cityModel.findById(cityId).lean<LeanDoc<City>>(),
      this.countryModel.findById(countryId).lean<LeanDoc<Country>>(),
    ]);

    const errors: { field: string; messages: string[] }[] = [];
    if (!city) errors.push({ field: 'cityId', messages: ['unknown city'] });
    if (!country) {
      errors.push({ field: 'countryId', messages: ['unknown country'] });
    }
    if (errors.length) {
      throw new BadRequestException({
        code: 'INVALID_REFERENCE',
        message: 'cityId and countryId must be seeded reference ids',
        errors,
      });
    }
    if (city!.countryId !== countryId) {
      throw new BadRequestException({
        code: 'CITY_COUNTRY_MISMATCH',
        message: 'The city does not belong to the given country',
        errors: [
          { field: 'cityId', messages: ['city is not in the given country'] },
        ],
      });
    }
  }

  private async findExistingOrThrow(hotelId: string): Promise<void> {
    const exists = await this.hotelModel.exists({ _id: hotelId });
    if (!exists) throw this.hotelNotFound();
  }

  // Checks the file's magic bytes; the client-sent MIME type is not trusted.
  private detectImageType(buffer: Buffer): HotelPhotoMimeType | null {
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'image/jpeg';
    }
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (buffer.length >= png.length && png.every((b, i) => buffer[i] === b)) {
      return 'image/png';
    }
    return null;
  }

  private resolveStoragePath(storageKey: string): string {
    const path = resolve(this.uploadsRoot, storageKey);
    if (!path.startsWith(this.uploadsRoot + sep)) {
      throw this.photoNotFound();
    }
    return path;
  }

  private async removeStoredFile(storageKey: string): Promise<void> {
    try {
      await unlink(this.resolveStoragePath(storageKey));
    } catch {
      // Already gone: the database row is the source of truth.
    }
  }

  private hotelNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'HOTEL_NOT_FOUND',
      message: 'Hotel not found',
    });
  }

  private photoNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'PHOTO_NOT_FOUND',
      message: 'Photo not found',
    });
  }

  private photoLimitReached(): ConflictException {
    return new ConflictException({
      code: 'PHOTO_LIMIT_REACHED',
      message: `A hotel can have at most ${HOTEL_MAX_PHOTOS} photos`,
    });
  }
}
