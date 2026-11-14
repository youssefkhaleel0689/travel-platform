import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ReviewsService } from "./reviews.service";
import {
  CreateHotelReviewDto,
  ReplyReviewDto,
  UpdateHotelReviewDto,
} from "./dto/review.dto";
import { B2AuthGuard } from "../common/auth/guards";
import { AuthUser, CurrentUser, Roles } from "../common/auth/auth-user";
import { PaginationQueryDto } from "../common/pagination/dto/pagination-query.dto";
import { Role } from "../common/constants";

@ApiTags("Hotel reviews (B2)")
@Controller()
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Post("hotel-bookings/:id/review")
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-23 Review a completed hotel booking (USER)",
    description:
      "Access: USER only — login required. The caller must own the completed hotel booking. Creates one rating from 1 to 5 and an optional review comment; only one review is allowed per reservation.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.USER)
  create(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CreateHotelReviewDto,
  ) {
    return this.service.create(user, id, dto);
  }

  @Patch("reviews/:id")
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-23 Edit my hotel review (USER)",
    description:
      "Access: USER only — login required. The caller may edit only their own review. Updates the supplied rating and/or comment and recalculates the hotel rating aggregate.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.USER)
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateHotelReviewDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete("reviews/:id")
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-23 Delete my hotel review (USER)",
    description:
      "Access: USER only — login required. The caller may delete only their own review. The hotel rating average and count are recalculated after deletion.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.USER)
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.remove(user, id);
  }

  @Post("reviews/:id/reply")
  @ApiCookieAuth()
  @ApiOperation({
    summary: "HTL-26 Reply to a hotel review (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to the hotel that owns the review. Creates or replaces the moderator reply on that review.",
  })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  reply(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: ReplyReviewDto,
  ) {
    return this.service.reply(user, id, dto);
  }

  @Get("hotels/:hotelId/reviews")
  @ApiOperation({
    summary: "HTL-24 List hotel reviews (PUBLIC)",
    description:
      "Access: PUBLIC — no login required. Returns visible reviews for the specified hotel, newest first, with the hotel average rating, rating count and pagination (10 reviews per page).",
  })
  list(@Param("hotelId") hotelId: string, @Query() q: PaginationQueryDto) {
    return this.service.listForHotel(hotelId, q.page);
  }
}
