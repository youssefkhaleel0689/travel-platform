import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { AvailabilityService } from "./availability.service";
import { CreateAvailabilityDto, RoomStatusQueryDto, UpdateAvailabilityDto } from "./dto/availability.dto";
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { Role } from '../../common/auth/auth.enums';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';

const HOTEL = '/api/hotels/6af83761fa40574d39eb7dc2';
const AVAIL = `${HOTEL}/rooms/6af8b9fdbc5624b5a1b41d6b/availability`;
const STATUS = `${HOTEL}/availability`;
const UNAUTH = { code: 'UNAUTHENTICATED', message: 'Authentication required' };
const FORBIDDEN = { code: 'FORBIDDEN', message: 'You do not have permission to do this' };
const VALIDATION = { code: 'VALIDATION_FAILED', message: 'Validation failed', errors: [{ field: 'body', messages: ['invalid value'] }] };
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Room not found in this hotel' };

@ApiTags("Hotel availability (B2)")
@ApiCookieAuth()
@Controller("hotels/:hotelId")
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  @Post("rooms/:roomId/availability")
  @ApiOkResponse({ description: 'The created availability range' })
  @ApiErrorResponse({ status: 400, description: 'Invalid range or overlapping range (VALIDATION_FAILED / BAD_REQUEST)', examples: [
    { ...VALIDATION, path: AVAIL },
    { code: 'BAD_REQUEST', message: 'Overlapping AVAILABLE range exists for this room', path: AVAIL },
  ] })
  @ApiErrorResponse({ status: 401, description: 'Not logged in (UNAUTHENTICATED)', examples: [{ ...UNAUTH, path: AVAIL }] })
  @ApiErrorResponse({ status: 403, description: 'Wrong role or not assigned to this hotel (FORBIDDEN)', examples: [{ ...FORBIDDEN, path: AVAIL }] })
  @ApiErrorResponse({ status: 404, description: 'Hotel or room not found (NOT_FOUND)', examples: [{ ...NOT_FOUND, path: AVAIL }] })
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: "HTL-04/06 Create room availability (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. Creates an AVAILABLE or BLOCKED date range for the specified room. Dates use a half-open interval [startDate, endDate).",
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
    @Body() dto: CreateAvailabilityDto,
  ) {
    return this.service.create(user, hotelId, roomId, dto);
  }

  @Get("rooms/:roomId/availability")
  @ApiOkResponse({ description: 'Configured availability ranges for the room' })
  @ApiErrorResponse({ status: 401, description: 'Not logged in (UNAUTHENTICATED)', examples: [{ ...UNAUTH, path: AVAIL }] })
  @ApiErrorResponse({ status: 403, description: 'Wrong role or not assigned to this hotel (FORBIDDEN)', examples: [{ ...FORBIDDEN, path: AVAIL }] })
  @ApiErrorResponse({ status: 404, description: 'Hotel or room not found (NOT_FOUND)', examples: [{ ...NOT_FOUND, path: AVAIL }] })
  @ApiParam({ name: "hotelId", description: "MongoDB ObjectId of the hotel containing the room.", example: "6af83761fa40574d39eb7dc2" })
  @ApiParam({ name: "roomId", description: "MongoDB ObjectId of the room whose availability is requested.", example: "6af8b9fdbc5624b5a1b41d6b" })
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @ApiOperation({
    summary: "List room availability ranges (HOTEL_MODERATOR or ADMIN)",
    description:
      "Access: HOTEL_MODERATOR or ADMIN — login required. Returns the configured AVAILABLE and BLOCKED ranges for the room.",
  })
  findForRoom(
    @CurrentUser() user: AuthenticatedUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
  ) {
    return this.service.findForRoom(user, hotelId, roomId);
  }

  @Patch("rooms/:roomId/availability")
  @ApiOkResponse({ description: 'The updated availability range' })
  @ApiErrorResponse({ status: 400, description: 'Invalid or overlapping range (VALIDATION_FAILED / BAD_REQUEST)', examples: [
    { ...VALIDATION, path: AVAIL },
    { code: 'BAD_REQUEST', message: 'Cannot remove availability for dates that have reservations', path: AVAIL },
  ] })
  @ApiErrorResponse({ status: 401, description: 'Not logged in (UNAUTHENTICATED)', examples: [{ ...UNAUTH, path: AVAIL }] })
  @ApiErrorResponse({ status: 403, description: 'Wrong role or not assigned to this hotel (FORBIDDEN)', examples: [{ ...FORBIDDEN, path: AVAIL }] })
  @ApiErrorResponse({ status: 404, description: 'Availability, hotel or room not found (NOT_FOUND)', examples: [{ ...NOT_FOUND, path: AVAIL }] })
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: "HTL-05/06 Update room availability (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. Updates the availability range identified by body.availabilityId. Overlapping AVAILABLE ranges are rejected.",
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.service.update(user, hotelId, roomId, dto);
  }

  @Delete("rooms/:roomId/availability/:availabilityId")
  @ApiOkResponse({ description: 'Deletion result' })
  @ApiErrorResponse({ status: 400, description: 'Dates have reservations (BAD_REQUEST)', examples: [{ code: 'BAD_REQUEST', message: 'Availability cannot be removed for dates that have reservations', path: `${AVAIL}/6af8c1a2bc5624b5a1b41d99` }] })
  @ApiErrorResponse({ status: 401, description: 'Not logged in (UNAUTHENTICATED)', examples: [{ ...UNAUTH, path: `${AVAIL}/6af8c1a2bc5624b5a1b41d99` }] })
  @ApiErrorResponse({ status: 403, description: 'Wrong role or not assigned to this hotel (FORBIDDEN)', examples: [{ ...FORBIDDEN, path: `${AVAIL}/6af8c1a2bc5624b5a1b41d99` }] })
  @ApiErrorResponse({ status: 404, description: 'Availability, hotel or room not found (NOT_FOUND)', examples: [{ ...NOT_FOUND, path: `${AVAIL}/6af8c1a2bc5624b5a1b41d99` }] })
  @ApiParam({ name: "hotelId", description: "MongoDB ObjectId of the hotel to which the moderator is assigned.", example: "6af83761fa40574d39eb7dc2" })
  @ApiParam({ name: "roomId", description: "MongoDB ObjectId of the room whose availability range is being deleted.", example: "6af8b9fdbc5624b5a1b41d6b" })
  @ApiParam({ name: "availabilityId", description: "MongoDB ObjectId of the availability record to delete.", example: "6af8c1a2bc5624b5a1b41d99" })
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: "Delete a room availability range (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. Deletes the specified availability record belonging to the specified room.",
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
    @Param("availabilityId") availabilityId: string,
  ) {
    return this.service.remove(user, hotelId, roomId, availabilityId);
  }

  @Get("availability")
  @ApiOkResponse({ description: 'Per-room status segments for the requested range' })
  @ApiErrorResponse({ status: 400, description: 'Invalid range (VALIDATION_FAILED / BAD_REQUEST)', examples: [
    { ...VALIDATION, path: STATUS },
    { code: 'BAD_REQUEST', message: 'Date range cannot exceed 366 nights', path: STATUS },
  ] })
  @ApiErrorResponse({ status: 401, description: 'Not logged in (UNAUTHENTICATED)', examples: [{ ...UNAUTH, path: STATUS }] })
  @ApiErrorResponse({ status: 403, description: 'Wrong role or not assigned to this hotel (FORBIDDEN)', examples: [{ ...FORBIDDEN, path: STATUS }] })
  @ApiErrorResponse({ status: 404, description: 'Hotel not found (HOTEL_NOT_FOUND)', examples: [{ code: 'HOTEL_NOT_FOUND', message: 'Hotel not found', path: STATUS }] })
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @ApiOperation({
    summary: "HTL-08 View hotel room status (HOTEL_MODERATOR or ADMIN)",
    description:
      "Access: HOTEL_MODERATOR or ADMIN — login required. Shows each room status across the requested date range: AVAILABLE, BOOKED with booking reference, or BLOCKED.",
  })
  statusView(
    @CurrentUser() user: AuthenticatedUser,
    @Param("hotelId") hotelId: string,
    @Query() q: RoomStatusQueryDto,
  ) {
    return this.service.roomStatusView(user, hotelId, q);
  }
}
