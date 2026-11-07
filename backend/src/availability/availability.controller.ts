import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { CreateAvailabilityDto, RoomStatusQueryDto, UpdateAvailabilityDto } from './dto/availability.dto';
import { B2AuthGuard } from '../common/auth/guards';
import { AuthUser, CurrentUser, Roles } from '../common/auth/auth-user';
import { Role } from '../common/constants';

@ApiTags('Hotel availability (B2)')
@ApiCookieAuth()
@Controller('hotels/:hotelId')
@UseGuards(B2AuthGuard)
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  @Post('rooms/:roomId/availability')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'HTL-04/06 Define a bookable (AVAILABLE) or BLOCKED date range for a room' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Body() dto: CreateAvailabilityDto,
  ) {
    return this.service.create(user, hotelId, roomId, dto);
  }

  @Get('rooms/:roomId/availability')
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  findForRoom(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Param('roomId') roomId: string) {
    return this.service.findForRoom(user, hotelId, roomId);
  }

  @Patch('rooms/:roomId/availability')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'HTL-05/06 Update an existing range (body.availabilityId identifies it)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.service.update(user, hotelId, roomId, dto);
  }

  @Delete('rooms/:roomId/availability/:availabilityId')
  @Roles(Role.HOTEL_MODERATOR)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Param('availabilityId') availabilityId: string,
  ) {
    return this.service.remove(user, hotelId, roomId, availabilityId);
  }

  @Get('availability')
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'HTL-08 Room status for a date range: AVAILABLE / BOOKED (with reference) / BLOCKED' })
  statusView(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Query() q: RoomStatusQueryDto) {
    return this.service.roomStatusView(user, hotelId, q);
  }
}
