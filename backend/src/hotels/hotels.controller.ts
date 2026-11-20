import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import { Role } from '../common/auth/auth.enums';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import {
  CurrentUser,
  OptionalUser,
} from '../common/auth/current-user.decorator';
import { Public } from '../common/auth/public.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { forbidden, unauthenticated } from '../common/swagger/standard-errors';
import { CreateHotelDto, HotelResponseDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import type { HotelActor, UploadedImageFile } from './hotels.service';
import { HotelsService } from './hotels.service';
import {
  HOTEL_PHOTO_MAX_BYTES,
  HOTEL_PHOTO_MIME_TYPES,
} from './schemas/hotel.schema';

// The service works with { id, role }; the logged-in user comes from the global
// JwtAuthGuard through @CurrentUser() / @OptionalUser().
function toActor(user: AuthenticatedUser): HotelActor {
  return { id: user.userId, role: user.role };
}

const HOTEL_ID = '6720f1c2a1b2c3d4e5f60718';
const PHOTO_ID = '6720f1c2a1b2c3d4e5f60719';
const HOTELS_PATH = '/api/hotels';
const HOTEL_PATH = `/api/hotels/${HOTEL_ID}`;
const PHOTOS_PATH = `/api/hotels/${HOTEL_ID}/photos`;
const PHOTO_PATH = `/api/hotels/${HOTEL_ID}/photos/${PHOTO_ID}`;

const HOTEL_ID_PARAM = {
  name: 'id',
  description: 'Hotel id (ObjectId)',
  example: HOTEL_ID,
};
const PHOTO_ID_PARAM = {
  name: 'photoId',
  description: 'Photo id (ObjectId)',
  example: PHOTO_ID,
};

const HOTEL_NOT_FOUND = {
  code: 'HOTEL_NOT_FOUND',
  message: 'Hotel not found',
};
const PHOTO_NOT_FOUND = {
  code: 'PHOTO_NOT_FOUND',
  message: 'Photo not found',
};
const INVALID_REFERENCE = {
  code: 'INVALID_REFERENCE',
  message: 'cityId and countryId must be seeded reference ids',
  errors: [{ field: 'cityId', messages: ['unknown city'] }],
};
const CITY_COUNTRY_MISMATCH = {
  code: 'CITY_COUNTRY_MISMATCH',
  message: 'The city does not belong to the given country',
  errors: [{ field: 'cityId', messages: ['city is not in the given country'] }],
};
const INVALID_ID = {
  code: 'INVALID_VALUE',
  message: 'Invalid value for "_id"',
  errors: [{ field: '_id', messages: ['invalid value'] }],
};

@ApiTags('Hotels')
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  // NOTE for B2: GET /hotels/search must be declared ABOVE GET /hotels/:id
  // in this controller, otherwise "search" is read as a hotel id.

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Create a hotel profile (admin) - HTL-01',
    description:
      'cityId and countryId must be seeded ids and the city must belong to the country. The hotel starts ACTIVE.',
  })
  @ApiCreatedResponse({ type: HotelResponseDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'A field is invalid (VALIDATION_FAILED), an id is not seeded (INVALID_REFERENCE), or the city is in another country (CITY_COUNTRY_MISMATCH)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: HOTELS_PATH,
        errors: [{ field: 'name', messages: ['name should not be empty'] }],
      },
      { ...INVALID_REFERENCE, path: HOTELS_PATH },
      { ...CITY_COUNTRY_MISMATCH, path: HOTELS_PATH },
    ],
  })
  @ApiErrorResponse(unauthenticated(HOTELS_PATH))
  @ApiErrorResponse(forbidden(HOTELS_PATH))
  create(
    @Body() dto: CreateHotelDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.create(dto, toActor(user));
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'List all hotels, newest first (admin) - HTL-01, GEN-05',
    description: 'Includes DEACTIVATED hotels. Page size 10.',
  })
  @ApiPaginatedResponse(HotelResponseDto)
  @ApiErrorResponse({
    status: 400,
    description: 'page is not a positive integer',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: HOTELS_PATH,
        errors: [{ field: 'page', messages: ['page must not be less than 1'] }],
      },
    ],
  })
  @ApiErrorResponse(unauthenticated(HOTELS_PATH))
  @ApiErrorResponse(forbidden(HOTELS_PATH))
  list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<HotelResponseDto>> {
    return this.hotelsService.list(query.page, toActor(user));
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get a hotel profile (public) - HTL-02',
    description:
      'A DEACTIVATED hotel returns 404, except for admins and its assigned moderator.',
  })
  @ApiParam(HOTEL_ID_PARAM)
  @ApiOkResponse({ type: HotelResponseDto })
  @ApiErrorResponse({
    status: 400,
    description: 'The id is not a valid ObjectId',
    examples: [{ ...INVALID_ID, path: '/api/hotels/abc' }],
  })
  @ApiErrorResponse({
    status: 404,
    description:
      'No such hotel, or it is DEACTIVATED and the caller cannot manage it',
    examples: [{ ...HOTEL_NOT_FOUND, path: HOTEL_PATH }],
  })
  findOne(
    @Param('id') id: string,
    @OptionalUser() user: AuthenticatedUser | undefined,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.findById(id, user && toActor(user));
  }

  @Patch(':id')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Edit the hotel profile (assigned hotel moderator) - HTL-01',
    description:
      'Send only the fields to change. status, rating fields and photos cannot be set here.',
  })
  @ApiParam(HOTEL_ID_PARAM)
  @ApiOkResponse({ type: HotelResponseDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'A field is invalid or null (VALIDATION_FAILED), an id is not seeded (INVALID_REFERENCE), or the city is in another country (CITY_COUNTRY_MISMATCH)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: HOTEL_PATH,
        errors: [{ field: 'name', messages: ['name must not be null'] }],
      },
      { ...INVALID_REFERENCE, path: HOTEL_PATH },
      { ...CITY_COUNTRY_MISMATCH, path: HOTEL_PATH },
    ],
  })
  @ApiErrorResponse(unauthenticated(HOTEL_PATH))
  @ApiErrorResponse({
    status: 403,
    description:
      'Not a hotel moderator (FORBIDDEN), a moderator of another hotel (HOTEL_NOT_ASSIGNED), or a password change is pending (PASSWORD_CHANGE_REQUIRED)',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
        path: HOTEL_PATH,
      },
      {
        code: 'HOTEL_NOT_ASSIGNED',
        message: 'You are not assigned to this hotel',
        path: HOTEL_PATH,
      },
      {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'A new password must be set before continuing',
        path: HOTEL_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such hotel',
    examples: [{ ...HOTEL_NOT_FOUND, path: HOTEL_PATH }],
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHotelDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.update(id, dto, toActor(user));
  }

  @Post(':id/photos')
  @Roles(Role.HOTEL_MODERATOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiCookieAuth()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: HOTEL_PHOTO_MAX_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (
          (HOTEL_PHOTO_MIME_TYPES as readonly string[]).includes(file.mimetype)
        ) {
          callback(null, true);
          return;
        }
        callback(
          new BadRequestException({
            code: 'INVALID_FILE_TYPE',
            message: 'Only JPG and PNG images are accepted',
            errors: [
              { field: 'file', messages: ['must be a JPG or PNG image'] },
            ],
          }),
          false,
        );
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPG or PNG, at most 5 MB',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a hotel photo (assigned hotel moderator) - HTL-01, GEN-08',
    description: 'JPG or PNG, at most 5 MB, at most 5 photos per hotel.',
  })
  @ApiParam(HOTEL_ID_PARAM)
  @ApiCreatedResponse({ type: HotelResponseDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'No file (FILE_REQUIRED), not a real JPG or PNG (INVALID_FILE_TYPE), or over 5 MB (FILE_TOO_LARGE)',
    examples: [
      {
        code: 'FILE_REQUIRED',
        message: 'A photo file is required',
        path: PHOTOS_PATH,
        errors: [{ field: 'file', messages: ['file is required'] }],
      },
      {
        code: 'INVALID_FILE_TYPE',
        message: 'Only JPG and PNG images are accepted',
        path: PHOTOS_PATH,
        errors: [{ field: 'file', messages: ['must be a JPG or PNG image'] }],
      },
      {
        code: 'FILE_TOO_LARGE',
        message: 'Images must be at most 5 MB',
        path: PHOTOS_PATH,
        errors: [{ field: 'file', messages: ['must be at most 5 MB'] }],
      },
    ],
  })
  @ApiErrorResponse(unauthenticated(PHOTOS_PATH))
  @ApiErrorResponse({
    status: 403,
    description:
      'Not a hotel moderator (FORBIDDEN) or a moderator of another hotel (HOTEL_NOT_ASSIGNED)',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
        path: PHOTOS_PATH,
      },
      {
        code: 'HOTEL_NOT_ASSIGNED',
        message: 'You are not assigned to this hotel',
        path: PHOTOS_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such hotel',
    examples: [{ ...HOTEL_NOT_FOUND, path: PHOTOS_PATH }],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'The hotel already has 5 photos',
    examples: [
      {
        code: 'PHOTO_LIMIT_REACHED',
        message: 'A hotel can have at most 5 photos',
        path: PHOTOS_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 413,
    description:
      'The upload is larger than 5 MB and was stopped while receiving it',
    examples: [
      { code: 'PAYLOAD_TOO_LARGE', message: 'File too large', path: PHOTOS_PATH },
    ],
  })
  addPhoto(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.addPhoto(id, file, toActor(user));
  }

  @Get(':id/photos/:photoId')
  @Public()
  @ApiOperation({
    summary: 'Download a hotel photo (public) - GEN-08',
    description:
      'Photos of a DEACTIVATED hotel are hidden like the hotel, except for admins and its assigned moderator.',
  })
  @ApiParam(HOTEL_ID_PARAM)
  @ApiParam(PHOTO_ID_PARAM)
  @ApiProduces(...HOTEL_PHOTO_MIME_TYPES)
  @ApiOkResponse({
    description: 'The image file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such hotel or photo, or the hotel is hidden',
    examples: [{ ...PHOTO_NOT_FOUND, path: PHOTO_PATH }],
  })
  async getPhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @OptionalUser() user: AuthenticatedUser | undefined,
  ): Promise<StreamableFile> {
    const photo = await this.hotelsService.getPhotoFile(
      id,
      photoId,
      user && toActor(user),
    );
    return new StreamableFile(createReadStream(photo.path), {
      type: photo.mimeType,
      length: photo.sizeBytes,
    });
  }

  @Delete(':id/photos/:photoId')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Remove a hotel photo (assigned hotel moderator) - HTL-01, GEN-08',
  })
  @ApiParam(HOTEL_ID_PARAM)
  @ApiParam(PHOTO_ID_PARAM)
  @ApiOkResponse({ type: HotelResponseDto })
  @ApiErrorResponse(unauthenticated(PHOTO_PATH))
  @ApiErrorResponse({
    status: 403,
    description:
      'Not a hotel moderator (FORBIDDEN) or a moderator of another hotel (HOTEL_NOT_ASSIGNED)',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
        path: PHOTO_PATH,
      },
      {
        code: 'HOTEL_NOT_ASSIGNED',
        message: 'You are not assigned to this hotel',
        path: PHOTO_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such hotel (HOTEL_NOT_FOUND) or photo (PHOTO_NOT_FOUND)',
    examples: [
      { ...HOTEL_NOT_FOUND, path: PHOTO_PATH },
      { ...PHOTO_NOT_FOUND, path: PHOTO_PATH },
    ],
  })
  removePhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.removePhoto(id, photoId, toActor(user));
  }
}
