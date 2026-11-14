import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HotelPoliciesService } from "./hotel-policies.service";
import { UpsertHotelPolicyDto } from "./dto/upsert-hotel-policy.dto";
import { B2AuthGuard } from "../common/auth/guards";
import { AuthUser, CurrentUser, Roles } from "../common/auth/auth-user";
import { Role } from "../common/constants";

@ApiTags("Hotel policies (B2)")
@Controller("hotels/:hotelId/policies")
export class HotelPoliciesController {
  constructor(private readonly service: HotelPoliciesService) {}

  @Put()
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-09/10 Manage hotel policies (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to {hotelId}. Creates or replaces the hotel check-in/check-out times and cancellation refund tiers. The policy version increments when updated.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  upsert(
    @CurrentUser() user: AuthUser,
    @Param("hotelId") hotelId: string,
    @Body() dto: UpsertHotelPolicyDto,
  ) {
    return this.service.upsert(user, hotelId, dto);
  }

  @Get()
  @ApiOperation({
    summary: "Read hotel policies (PUBLIC)",
    description:
      "Access: PUBLIC — no login required. Returns the current check-in/check-out times, cancellation tiers and policy version for the specified hotel.",
  })
  find(@Param("hotelId") hotelId: string) {
    return this.service.findByHotel(hotelId);
  }
}
