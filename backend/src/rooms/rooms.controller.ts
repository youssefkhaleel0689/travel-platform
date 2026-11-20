import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { Public } from '../common/auth/public.decorator';
import { Role } from '../common/auth/auth.enums';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';

const HOTEL = '/api/hotels/6af83761fa40574d39eb7dc2';
const ROOM = `${HOTEL}/rooms/6af8b9fdbc5624b5a1b41d6b`;
const UNAUTH = { code: 'UNAUTHENTICATED', message: 'Authentication required' };
const FORBIDDEN = {
  code: 'FORBIDDEN',
  message: 'You do not have permission to do this',
};
const NOT_FOUND = {
  code: 'NOT_FOUND',
  message: 'Room not found in this hotel',
};
const VALIDATION = {
  code: 'VALIDATION_FAILED',
  message: 'Validation failed',
  errors: [{ field: 'body', messages: ['invalid value'] }],
};

@ApiTags('Hotel rooms (B2)')
@Controller('hotels/:hotelId/rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'The created room' })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed (VALIDATION_FAILED)',
    examples: [{ ...VALIDATION, path: `${HOTEL}/rooms` }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Hotel not found (HOTEL_NOT_FOUND)',
    examples: [
      {
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
        path: `${HOTEL}/rooms`,
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: `${HOTEL}/rooms` }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role or not assigned to this hotel (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: `${HOTEL}/rooms` }],
  })
  @ApiOperation({
    summary: 'HTL-03 Create a room (HOTEL_MODERATOR)',
    description:
      'Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to the hotel in {hotelId}. Creates a room with its room number, type, beds, occupancy and nightly price.',
  })
  @Roles(Role.HOTEL_MODERATOR)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
    @Body() dto: CreateRoomDto,
  ) {
    return this.roomsService.create(user, hotelId, dto);
  }

  @Get()
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'Paginated list of rooms' })
  @ApiErrorResponse({
    status: 404,
    description: 'Hotel not found (HOTEL_NOT_FOUND)',
    examples: [
      {
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
        path: `${HOTEL}/rooms`,
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: `${HOTEL}/rooms` }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role or not assigned to this hotel (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: `${HOTEL}/rooms` }],
  })
  @ApiOperation({
    summary: 'List hotel rooms (HOTEL_MODERATOR or ADMIN)',
    description:
      "Access: HOTEL_MODERATOR or ADMIN — login required. The HOTEL_MODERATOR must be assigned to {hotelId}; ADMIN may inspect rooms across hotels. Returns the hotel's rooms in pages of 10.",
  })
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
    @Query() q: PaginationQueryDto,
  ) {
    return this.roomsService.findByHotel(user, hotelId, q.page);
  }

  // NOTE: must stay above ':roomId' so "available" is not parsed as a room id.
  @Get('available')
  @Public()
  @ApiOkResponse({
    description: 'Rooms available for the whole requested stay',
  })
  @ApiErrorResponse({
    status: 400,
    description: 'Invalid dates (VALIDATION_FAILED)',
    examples: [{ ...VALIDATION, path: `${HOTEL}/rooms/available` }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Hotel not found or not active (HOTEL_NOT_FOUND)',
    examples: [
      {
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
        path: `${HOTEL}/rooms/available`,
      },
    ],
  })
  @ApiOperation({
    summary: 'HTL-15 Find available rooms (PUBLIC)',
    description:
      'Access: PUBLIC — no login required. Returns rooms that are available for the entire check-in/check-out range, with nightly price and calculated total stay price.',
  })
  available(
    @Param('hotelId') hotelId: string,
    @Query() q: AvailableRoomsQueryDto,
  ) {
    return this.roomsService.findAvailable(
      hotelId,
      q.checkInDate,
      q.checkOutDate,
    );
  }

  @Get(':roomId')
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'The room details' })
  @ApiErrorResponse({
    status: 404,
    description: 'Room not found in this hotel (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: ROOM }],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: ROOM }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role or not assigned to this hotel (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: ROOM }],
  })
  @ApiParam({
    name: 'hotelId',
    description: 'MongoDB ObjectId of the hotel containing the room.',
    example: '6af83761fa40574d39eb7dc2',
  })
  @ApiParam({
    name: 'roomId',
    description: 'MongoDB ObjectId of the room to retrieve.',
    example: '6af8b9fdbc5624b5a1b41d6b',
  })
  @ApiOperation({
    summary: 'Get room details (HOTEL_MODERATOR or ADMIN)',
    description:
      'Access: HOTEL_MODERATOR or ADMIN — login required. The HOTEL_MODERATOR must be assigned to {hotelId}; ADMIN may inspect rooms across hotels. Returns the details of the specified room.',
  })
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
  ) {
    return this.roomsService.findOne(user, hotelId, roomId);
  }

  @Patch(':roomId')
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'The updated room' })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed (VALIDATION_FAILED)',
    examples: [{ ...VALIDATION, path: ROOM }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Room not found in this hotel (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: ROOM }],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: ROOM }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role or not assigned to this hotel (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: ROOM }],
  })
  @ApiOperation({
    summary: 'HTL-05 Update a room (HOTEL_MODERATOR)',
    description:
      'Access: HOTEL_MODERATOR only — login required. Updates only supplied room fields. Existing reservations keep their booking-time room and price snapshots.',
  })
  @Roles(Role.HOTEL_MODERATOR)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomsService.update(user, hotelId, roomId, dto);
  }

  @Patch(':roomId/deactivate')
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'The deactivated room' })
  @ApiErrorResponse({
    status: 400,
    description: 'Room has an upcoming reservation (BAD_REQUEST)',
    examples: [
      {
        code: 'BAD_REQUEST',
        message:
          'Room cannot be deactivated while it has an upcoming CONFIRMED or PENDING_PAYMENT reservation',
        path: `${ROOM}/deactivate`,
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Room not found in this hotel (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: `${ROOM}/deactivate` }],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: `${ROOM}/deactivate` }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role or not assigned to this hotel (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: `${ROOM}/deactivate` }],
  })
  @ApiOperation({
    summary: 'HTL-06 Deactivate a room (HOTEL_MODERATOR)',
    description:
      'Access: HOTEL_MODERATOR only — login required. Deactivation is rejected when the room has overlapping PENDING_PAYMENT or CONFIRMED reservations.',
  })
  @Roles(Role.HOTEL_MODERATOR)
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
  ) {
    return this.roomsService.deactivate(user, hotelId, roomId);
  }

  @Patch(':roomId/activate')
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'The activated room' })
  @ApiErrorResponse({
    status: 404,
    description: 'Room not found in this hotel (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: `${ROOM}/activate` }],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: `${ROOM}/activate` }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role or not assigned to this hotel (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: `${ROOM}/activate` }],
  })
  @ApiParam({
    name: 'hotelId',
    description:
      'MongoDB ObjectId of the hotel to which the moderator is assigned.',
    example: '6af83761fa40574d39eb7dc2',
  })
  @ApiParam({
    name: 'roomId',
    description: 'MongoDB ObjectId of the room to activate.',
    example: '6af8b9fdbc5624b5a1b41d6b',
  })
  @ApiOperation({
    summary: 'HTL-06 Activate a room (HOTEL_MODERATOR)',
    description:
      'Access: HOTEL_MODERATOR only — login required. Reactivates a previously deactivated room so it can be managed and considered for availability, subject to the service rules.',
  })
  @Roles(Role.HOTEL_MODERATOR)
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
  ) {
    return this.roomsService.activate(user, hotelId, roomId);
  }

  @Delete(':roomId')
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'Deletion result' })
  @ApiErrorResponse({
    status: 400,
    description: 'Room has reservation history (BAD_REQUEST)',
    examples: [
      {
        code: 'BAD_REQUEST',
        message:
          'A room that has been reserved cannot be deleted; deactivate it instead',
        path: ROOM,
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Room not found in this hotel (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: ROOM }],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: ROOM }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role or not assigned to this hotel (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: ROOM }],
  })
  @ApiOperation({
    summary: 'HTL-06 Delete a room (HOTEL_MODERATOR)',
    description:
      'Access: HOTEL_MODERATOR only — login required. Permanently deletes a room only when it has never been reserved; rooms with reservation history must not be deleted.',
  })
  @Roles(Role.HOTEL_MODERATOR)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
  ) {
    return this.roomsService.remove(user, hotelId, roomId);
  }
}
