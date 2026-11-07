import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { B2AuthGuard } from '../common/auth/guards';
import { CurrentUser, AuthUser, Roles } from '../common/auth/auth-user';
import { Role } from '../common/constants';
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';

@ApiTags('Hotel rooms (B2)')
@Controller('hotels/:hotelId/rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-03 Add a room to the moderator\'s own hotel' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  create(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Body() dto: CreateRoomDto) {
    return this.roomsService.create(user, hotelId, dto);
  }

  @Get()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'List all rooms of a hotel (moderator/admin, paginated)' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  list(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Query() q: PaginationQueryDto) {
    return this.roomsService.findByHotel(user, hotelId, q.page);
  }

  // NOTE: must stay above ':roomId' so "available" is not parsed as a room id.
  @Get('available')
  @ApiOperation({ summary: 'HTL-15 Rooms free for the whole stay, with price per night and total stay price (public)' })
  available(@Param('hotelId') hotelId: string, @Query() q: AvailableRoomsQueryDto) {
    return this.roomsService.findAvailable(hotelId, q.checkInDate, q.checkOutDate);
  }

  @Get(':roomId')
  @ApiCookieAuth()
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  findOne(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Param('roomId') roomId: string) {
    return this.roomsService.findOne(user, hotelId, roomId);
  }

  @Patch(':roomId')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-05 Edit beds, occupancy, price, etc. (existing reservations are unaffected)' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  update(
    @CurrentUser() user: AuthUser,
    @Param('hotelId') hotelId: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomsService.update(user, hotelId, roomId, dto);
  }

  @Patch(':roomId/deactivate')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-06 Deactivate (rejected if CONFIRMED/PENDING_PAYMENT reservations exist)' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  deactivate(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Param('roomId') roomId: string) {
    return this.roomsService.deactivate(user, hotelId, roomId);
  }

  @Patch(':roomId/activate')
  @ApiCookieAuth()
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  activate(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Param('roomId') roomId: string) {
    return this.roomsService.activate(user, hotelId, roomId);
  }

  @Delete(':roomId')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-06 Delete a room that has never been reserved' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  remove(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Param('roomId') roomId: string) {
    return this.roomsService.remove(user, hotelId, roomId);
  }
}
