import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HotelBookingsService } from "./hotel-bookings.service";
import {
  CancelBookingDto,
  CreateHotelBookingDto,
  ListBookingsQueryDto,
  ReservationsQueryDto,
} from "./dto/hotel-booking.dto";
import { B2AuthGuard } from "../common/auth/guards";
import { AuthUser, CurrentUser, Roles } from "../common/auth/auth-user";
import { Role } from "../common/constants";

@ApiTags("Hotel bookings (B2)")
@ApiCookieAuth()
@Controller("hotel-bookings")
@UseGuards(B2AuthGuard)
export class HotelBookingsController {
  constructor(private readonly service: HotelBookingsService) {}

  @Post()
  @Roles(Role.USER)
  @ApiOperation({
    summary: "HTL-16/18 Create a hotel booking (USER)",
    description:
      "Access: USER only — login required. Creates one reservation for one or more rooms and holds all requested rooms together for 10 minutes in PENDING_PAYMENT. The authenticated user is the booking owner; userId must not be supplied in the request body.",
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateHotelBookingDto) {
    return this.service.createHold(user, dto);
  }

  @Get()
  @Roles(Role.USER)
  @ApiOperation({
    summary: "HTL-20 List my hotel bookings (USER)",
    description:
      "Access: USER only — login required. Returns only the authenticated user's hotel reservations, grouped into UPCOMING, PAST and CANCELLED, with pagination.",
  })
  list(@CurrentUser() user: AuthUser, @Query() q: ListBookingsQueryDto) {
    return this.service.listMine(user, q);
  }

  @Get(":id")
  @Roles(Role.USER, Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      "HTL-20 Get hotel booking details (USER / ADMIN / HOTEL_MODERATOR)",
    description:
      "Access: USER, ADMIN or HOTEL_MODERATOR — login required. USER may view only their own booking; ADMIN may view any booking; HOTEL_MODERATOR may view bookings for their assigned hotel only.",
  })
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.findOneFor(user, id);
  }

  @Get(":id/cancellation-preview")
  @Roles(Role.USER)
  @ApiOperation({
    summary: "HTL-21 Preview hotel booking cancellation (booking owner USER)",
    description:
      "Access: USER only — login required. The caller must own the booking. Calculates the cancellation refund percentage and amount using the hotel policy that applies at the time of cancellation; does not cancel the booking.",
  })
  preview(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.cancellationPreview(user, id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @Roles(Role.USER)
  @ApiOperation({
    summary: "HTL-21 Cancel a hotel booking (booking owner USER)",
    description:
      "Access: USER only — login required. The caller must own the booking and set body.confirm to true. Cancels the entire reservation and applies the cancellation/refund rules.",
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.service.cancel(user, id, dto);
  }
}

@ApiTags("Hotel bookings (B2)")
@ApiCookieAuth()
@Controller("hotels/:hotelId/reservations")
@UseGuards(B2AuthGuard)
export class HotelReservationsController {
  constructor(private readonly service: HotelBookingsService) {}

  @Get()
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @ApiOperation({
    summary: "HTL-22 List hotel reservations (HOTEL_MODERATOR or ADMIN)",
    description:
      "Access: HOTEL_MODERATOR or ADMIN — login required. The HOTEL_MODERATOR must be assigned to {hotelId}; ADMIN may inspect reservations across hotels. Returns reservation guest details, dates and statuses.",
  })
  list(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Query() q: ReservationsQueryDto,
  ) {
    return this.service.listForHotel(user, hotelId, q);
  }
}
