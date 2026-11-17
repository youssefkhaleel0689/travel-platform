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
  Req,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createReadStream } from 'node:fs';
import { normaliseUser } from '../common/auth/auth-user';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';
import { CreateHotelDto, HotelResponseDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import type { HotelActor, UploadedImageFile } from './hotels.service';
import { HotelsService } from './hotels.service';
import {
  HOTEL_PHOTO_MAX_BYTES,
  HOTEL_PHOTO_MIME_TYPES,
} from './schemas/hotel.schema';

// Reuse the shared auth normalizer so B1 accepts the agreed Auth shape and
// compatible id aliases without duplicating authentication parsing here.
type RequestWithActor = Request & { user?: unknown };

function toHotelActor(rawUser: unknown): HotelActor | undefined {
  const user = normaliseUser(rawUser);
  if (!user) return undefined;
  return { id: user.userId, role: user.role };
}

function requireActor(req: RequestWithActor): HotelActor {
  const actor = toHotelActor(req.user);
  if (!actor) {
    throw new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message: 'Login required',
    });
  }
  return actor;
}

const HOTEL_ID_PARAM = {
  name: 'id',
  description: 'Hotel id (ObjectId)',
  example: '6720f1c2a1b2c3d4e5f60718',
};

@ApiTags('Hotels')
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  // NOTE for B2: GET /hotels/search must be declared ABOVE GET /hotels/:id
  // in this controller, otherwise "search" is read as a hotel id.

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Create a hotel profile (admin) - HTL-01',
    description:
      'cityId and countryId must be seeded ids and the city must belong to the country. The hotel starts ACTIVE.',
  })
  @ApiCreatedResponse({ type: HotelResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  create(
    @Body() dto: CreateHotelDto,
    @Req() req: RequestWithActor,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.create(dto, requireActor(req));
  }

  @Get()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'List all hotels, newest first (admin) - HTL-01, GEN-05',
    description: 'Includes DEACTIVATED hotels. Page size 10.',
  })
  @ApiPaginatedResponse(HotelResponseDto)
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  list(
    @Query() query: PaginationQueryDto,
    @Req() req: RequestWithActor,
  ): Promise<PageDto<HotelResponseDto>> {
    return this.hotelsService.list(query.page, requireActor(req));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a hotel profile (public) - HTL-02',
    description:
      'A DEACTIVATED hotel returns 404, except for admins and its assigned moderator.',
  })
  @ApiParam(HOTEL_ID_PARAM)
  @ApiOkResponse({ type: HotelResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findOne(
    @Param('id') id: string,
    @Req() req: RequestWithActor,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.findById(id, toHotelActor(req.user));
  }

  @Patch(':id')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Edit the hotel profile (assigned hotel moderator) - HTL-01',
    description:
      'Send only the fields to change. status, rating fields and photos cannot be set here.',
  })
  @ApiParam(HOTEL_ID_PARAM)
  @ApiOkResponse({ type: HotelResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHotelDto,
    @Req() req: RequestWithActor,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.update(id, dto, requireActor(req));
  }

  @Post(':id/photos')
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
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The hotel already has 5 photos',
  })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  addPhoto(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Req() req: RequestWithActor,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.addPhoto(id, file, requireActor(req));
  }

  @Get(':id/photos/:photoId')
  @ApiOperation({
    summary: 'Download a hotel photo (public) - GEN-08',
  })
  @ApiParam(HOTEL_ID_PARAM)
  @ApiParam({ name: 'photoId', description: 'Photo id (ObjectId)' })
  @ApiProduces(...HOTEL_PHOTO_MIME_TYPES)
  @ApiOkResponse({
    description: 'The image file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async getPhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Req() req: RequestWithActor,
  ): Promise<StreamableFile> {
    const photo = await this.hotelsService.getPhotoFile(
      id,
      photoId,
      toHotelActor(req.user),
    );
    return new StreamableFile(createReadStream(photo.path), {
      type: photo.mimeType,
      length: photo.sizeBytes,
    });
  }

  @Delete(':id/photos/:photoId')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Remove a hotel photo (assigned hotel moderator) - HTL-01, GEN-08',
  })
  @ApiParam(HOTEL_ID_PARAM)
  @ApiParam({ name: 'photoId', description: 'Photo id (ObjectId)' })
  @ApiOkResponse({ type: HotelResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  removePhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Req() req: RequestWithActor,
  ): Promise<HotelResponseDto> {
    return this.hotelsService.removePhoto(id, photoId, requireActor(req));
  }
}
