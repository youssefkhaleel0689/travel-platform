import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  CancelBookingDto, CreateHotelBookingDto, ListBookingsQueryDto, ReservationsQueryDto,
} from './dto/hotel-booking.dto';
import { B2AuthGuard } from '../common/auth/guards';
import { AuthUser, CurrentUser, Roles } from '../common/auth/auth-user';
import { Role } from '../common/constants';

@ApiTags('Hotel bookings (B2)')
@ApiCookieAuth()
@Controller('hotel-bookings')
@UseGuards(B2AuthGuard)
export class HotelBookingsController {
  constructor(private readonly service: HotelBookingsService) {}

  @Post()
  @Roles(Role.USER)
  @ApiOperation({ summary: 'HTL-16/18 Create one reservation for 1..n rooms and hold all rooms for 10 minutes (PENDING_PAYMENT)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateHotelBookingDto) {
    return this.service.createHold(user, dto);
  }

  @Get()
  @Roles(Role.USER)
  @ApiOperation({ summary: 'HTL-20 My reservations, grouped UPCOMING / PAST / CANCELLED (paginated)' })
  list(@CurrentUser() user: AuthUser, @Query() q: ListBookingsQueryDto) {
    return this.service.listMine(user, q);
  }

  @Get(':id')
  @Roles(Role.USER, Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'HTL-20 Reservation details (owner; admin; moderator of that hotel)' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOneFor(user, id);
  }

  @Get(':id/cancellation-preview')
  @Roles(Role.USER)
  @ApiOperation({ summary: 'HTL-21 Refund the user would receive if they cancel now' })
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancellationPreview(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.USER)
  @ApiOperation({ summary: 'HTL-21 Cancel the whole reservation (body.confirm must be true)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelBookingDto) {
    return this.service.cancel(user, id, dto);
  }
}

@ApiTags('Hotel bookings (B2)')
@ApiCookieAuth()
@Controller('hotels/:hotelId/reservations')
@UseGuards(B2AuthGuard)
export class HotelReservationsController {
  constructor(private readonly service: HotelBookingsService) {}

  @Get()
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'HTL-22 Reservations of the moderator\'s own hotel (guest, dates, status)' })
  list(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Query() q: ReservationsQueryDto) {
    return this.service.listForHotel(user, hotelId, q);
  }
}
