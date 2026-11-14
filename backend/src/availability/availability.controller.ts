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
import { AvailabilityService } from "./availability.service";
import {
  CreateAvailabilityDto,
  RoomStatusQueryDto,
  UpdateAvailabilityDto,
} from "./dto/availability.dto";
import { B2AuthGuard } from "../common/auth/guards";
import { AuthUser, CurrentUser, Roles } from "../common/auth/auth-user";
import { Role } from "../common/constants";

@ApiTags("Hotel availability (B2)")
@ApiCookieAuth()
@Controller("hotels/:hotelId")
@UseGuards(B2AuthGuard)
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  @Post("rooms/:roomId/availability")
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: "HTL-04/06 Create room availability (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to {hotelId}. Creates an AVAILABLE or BLOCKED date range for the specified room. Dates use a half-open interval [startDate, endDate).",
  })
  create(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
    @Body() dto: CreateAvailabilityDto,
  ) {
    return this.service.create(user, hotelId, roomId, dto);
  }

  @Get("rooms/:roomId/availability")
  @ApiOperation({
    summary: "List room availability ranges (HOTEL_MODERATOR or ADMIN)",
    description:
      "Access: HOTEL_MODERATOR or ADMIN — login required. The HOTEL_MODERATOR must be assigned to {hotelId}; ADMIN may inspect availability across hotels. Returns the configured AVAILABLE and BLOCKED ranges for the room.",
  })
  @ApiParam({
    name: "hotelId",
    description: "MongoDB ObjectId of the hotel containing the room.",
    example: "6af83761fa40574d39eb7dc2",
  })
  @ApiParam({
    name: "roomId",
    description:
      "MongoDB ObjectId of the room whose availability is requested.",
    example: "6af8b9fdbc5624b5a1b41d6b",
  })
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  findForRoom(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
  ) {
    return this.service.findForRoom(user, hotelId, roomId);
  }

  @Patch("rooms/:roomId/availability")
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: "HTL-05/06 Update room availability (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to {hotelId}. Updates the availability range identified by body.availabilityId. Overlapping AVAILABLE ranges are rejected.",
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.service.update(user, hotelId, roomId, dto);
  }

  @Delete("rooms/:roomId/availability/:availabilityId")
  @ApiOperation({
    summary: "Delete a room availability range (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to {hotelId}. Deletes the specified availability record belonging to the specified room.",
  })
  @ApiParam({
    name: "hotelId",
    description:
      "MongoDB ObjectId of the hotel to which the moderator is assigned.",
    example: "6af83761fa40574d39eb7dc2",
  })
  @ApiParam({
    name: "roomId",
    description:
      "MongoDB ObjectId of the room whose availability range is being deleted.",
    example: "6af8b9fdbc5624b5a1b41d6b",
  })
  @ApiParam({
    name: "availabilityId",
    description: "MongoDB ObjectId of the availability record to delete.",
    example: "6af8c1a2bc5624b5a1b41d99",
  })
  @Roles(Role.HOTEL_MODERATOR)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Param("roomId") roomId: string,
    @Param("availabilityId") availabilityId: string,
  ) {
    return this.service.remove(user, hotelId, roomId, availabilityId);
  }

  @Get("availability")
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @ApiOperation({
    summary: "HTL-08 View hotel room status (HOTEL_MODERATOR or ADMIN)",
    description:
      "Access: HOTEL_MODERATOR or ADMIN — login required. The HOTEL_MODERATOR must be assigned to {hotelId}; ADMIN may inspect the hotel. Shows each room status across the requested date range: AVAILABLE, BOOKED with booking reference, or BLOCKED.",
  })
  statusView(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Query() q: RoomStatusQueryDto,
  ) {
    return this.service.roomStatusView(user, hotelId, q);
  }
}
