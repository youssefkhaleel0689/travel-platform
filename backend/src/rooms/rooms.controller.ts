import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { RoomsService } from "./rooms.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";
import { AvailableRoomsQueryDto } from "./dto/available-rooms-query.dto";
import { B2AuthGuard } from "../common/auth/guards";
import { CurrentUser, AuthUser, Roles } from "../common/auth/auth-user";
import { Role } from "../common/constants";
import { PaginationQueryDto } from "../common/pagination/dto/pagination-query.dto";

@ApiTags("Hotel rooms (B2)")
@Controller("hotels/:hotelId/rooms")
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-03 Create a room (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to the hotel in {hotelId}. Creates a room with its room number, type, beds, occupancy and nightly price.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  create(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Body() dto: CreateRoomDto,
  ) {
    return this.roomsService.create(user, hotelId, dto);
  }

  @Get()
  @ApiCookieAuth()
  @ApiOperation({
    summary: "List hotel rooms (HOTEL_MODERATOR or ADMIN)",
    description:
      "Access: HOTEL_MODERATOR or ADMIN — login required. The HOTEL_MODERATOR must be assigned to {hotelId}; ADMIN may inspect rooms across hotels. Returns the hotel's rooms in pages of 10.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  list(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Query() q: PaginationQueryDto,
  ) {
    return this.roomsService.findByHotel(user, hotelId, q.page);
  }

  // NOTE: must stay above ':roomId' so "available" is not parsed as a room id.
  @Get("available")
  @ApiOperation({
    summary: "HTL-15 Find available rooms (PUBLIC)",
    description:
      "Access: PUBLIC — no login required. Returns rooms that are available for the entire check-in/check-out range, with nightly price and calculated total stay price.",
  })
  available(
    @Param("hotelId") hotelId: string,
    @Query() q: AvailableRoomsQueryDto,
  ) {
    return this.roomsService.findAvailable(
      hotelId,
      q.checkInDate,
      q.checkOutDate,
    );
  }

  @Get(":roomId")
  @ApiCookieAuth()
  @ApiOperation({
    summary: "Get room details (HOTEL_MODERATOR or ADMIN)",
    description:
      "Access: HOTEL_MODERATOR or ADMIN — login required. The HOTEL_MODERATOR must be assigned to {hotelId}; ADMIN may inspect rooms across hotels. Returns the details of the specified room.",
  })
  @ApiParam({
    name: "hotelId",
    description: "MongoDB ObjectId of the hotel containing the room.",
    example: "6af83761fa40574d39eb7dc2",
  })
  @ApiParam({
    name: "roomId",
    description: "MongoDB ObjectId of the room to retrieve.",
    example: "6af8b9fdbc5624b5a1b41d6b",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
  ) {
    return this.roomsService.findOne(user, hotelId, roomId);
  }

  @Patch(":roomId")
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-05 Update a room (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to {hotelId}. Updates only supplied room fields. Existing reservations keep their booking-time room and price snapshots.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  update(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomsService.update(user, hotelId, roomId, dto);
  }

  @Patch(":roomId/deactivate")
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-06 Deactivate a room (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to {hotelId}. Deactivation is rejected when the room has overlapping PENDING_PAYMENT or CONFIRMED reservations.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
  ) {
    return this.roomsService.deactivate(user, hotelId, roomId);
  }

  @Patch(":roomId/activate")
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-06 Activate a room (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to {hotelId}. Reactivates a previously deactivated room so it can be managed and considered for availability, subject to the service rules.",
  })
  @ApiParam({
    name: "hotelId",
    description:
      "MongoDB ObjectId of the hotel to which the moderator is assigned.",
    example: "6af83761fa40574d39eb7dc2",
  })
  @ApiParam({
    name: "roomId",
    description: "MongoDB ObjectId of the room to activate.",
    example: "6af8b9fdbc5624b5a1b41d6b",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  activate(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
  ) {
    return this.roomsService.activate(user, hotelId, roomId);
  }

  @Delete(":roomId")
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-06 Delete a room (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to {hotelId}. Permanently deletes a room only when it has never been reserved; rooms with reservation history must not be deleted.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
  ) {
    return this.roomsService.remove(user, hotelId, roomId);
  }
}
