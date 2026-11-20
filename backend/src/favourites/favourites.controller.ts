import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { FavouritesService } from './favourites.service';
import { FavouriteDto, FavouritesQueryDto } from './dto/favourite.dto';
import { FavouriteType } from './schemas/favourite.schema';

const PATH = '/api/favourites';

@ApiTags('Favourites (BON-02)')
@ApiCookieAuth()
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Post('hotels/:hotelId')
  @ApiOperation({
    summary: 'Save a hotel to your favourites (BON-02)',
  })
  @ApiOkResponse({ type: FavouriteDto })
  saveHotel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
  ): Promise<FavouriteDto> {
    return this.favourites.add(user, FavouriteType.HOTEL, hotelId);
  }

  @Delete('hotels/:hotelId')
  @ApiOperation({ summary: 'Remove a hotel from your favourites (BON-02)' })
  @ApiOkResponse({ type: FavouriteDto })
  removeHotel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
  ): Promise<void> {
    return this.favourites.remove(user, FavouriteType.HOTEL, hotelId);
  }

  @Post('itineraries/:itineraryId')
  @ApiOperation({
    summary: 'Save a PUBLIC itinerary to your favourites (BON-02)',
  })
  @ApiOkResponse({ type: FavouriteDto })
  saveItinerary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itineraryId') itineraryId: string,
  ): Promise<FavouriteDto> {
    return this.favourites.add(user, FavouriteType.ITINERARY, itineraryId);
  }

  @Delete('itineraries/:itineraryId')
  @ApiOperation({ summary: 'Remove an itinerary from your favourites (BON-02)' })
  @ApiOkResponse({ type: FavouriteDto })
  removeItinerary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itineraryId') itineraryId: string,
  ): Promise<void> {
    return this.favourites.remove(user, FavouriteType.ITINERARY, itineraryId);
  }

  @Get()
  @ApiOperation({
    summary: 'List your favourite hotels and itineraries (BON-02)',
    description: `Newest first, 10 per page. Optional type filter. ${PATH}`,
  })
  @ApiOkResponse({ type: [FavouriteDto] })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FavouritesQueryDto,
  ): Promise<FavouriteDto[]> {
    return this.favourites.list(user, query.type);
  }
}
