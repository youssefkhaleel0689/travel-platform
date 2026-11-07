import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateHotelReviewDto, ReplyReviewDto, UpdateHotelReviewDto } from './dto/review.dto';
import { B2AuthGuard } from '../common/auth/guards';
import { AuthUser, CurrentUser, Roles } from '../common/auth/auth-user';
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';
import { Role } from '../common/constants';

@ApiTags('Hotel reviews (B2)')
@Controller()
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-23 Rate (1-5) and review a COMPLETED reservation (once per reservation)' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.USER)
  create(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateHotelReviewDto) {
    return this.service.create(user, id, dto);
  }

  @Patch('reviews/:id')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-23 Edit own review' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.USER)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateHotelReviewDto) {
    return this.service.update(user, id, dto);
  }

  @Delete('reviews/:id')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-23 Delete own review' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.USER)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }

  @Post('reviews/:id/reply')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-26 (bonus) Hotel moderator replies to a review of their own hotel' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyReviewDto) {
    return this.service.reply(user, id, dto);
  }

  @Get('hotels/:hotelId/reviews')
  @ApiOperation({ summary: 'HTL-24 Average rating, rating count and reviews (newest first, 10 per page) - public' })
  list(@Param('hotelId') hotelId: string, @Query() q: PaginationQueryDto) {
    return this.service.listForHotel(hotelId, q.page);
  }
}
