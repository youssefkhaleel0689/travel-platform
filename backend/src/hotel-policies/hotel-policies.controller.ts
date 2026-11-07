import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HotelPoliciesService } from './hotel-policies.service';
import { UpsertHotelPolicyDto } from './dto/upsert-hotel-policy.dto';
import { B2AuthGuard } from '../common/auth/guards';
import { AuthUser, CurrentUser, Roles } from '../common/auth/auth-user';
import { Role } from '../common/constants';

@ApiTags('Hotel policies (B2)')
@Controller('hotels/:hotelId/policies')
export class HotelPoliciesController {
  constructor(private readonly service: HotelPoliciesService) {}

  @Put()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-09/10 Set check-in/out times and cancellation tiers (assigned moderator only)' })
  @UseGuards(B2AuthGuard)
  @Roles(Role.HOTEL_MODERATOR)
  upsert(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string, @Body() dto: UpsertHotelPolicyDto) {
    return this.service.upsert(user, hotelId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Read the hotel policy (public; used by the hotel details page)' })
  find(@Param('hotelId') hotelId: string) {
    return this.service.findByHotel(hotelId);
  }
}
