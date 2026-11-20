import { Controller, Delete, Param, Post, Body } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { LinkBookingDto } from './dto/booking-link.dto';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  ITINERARY_NOT_FOUND_EXAMPLE,
  notFoundError,
} from './itinerary-api-docs';
import { ItineraryBookingLinksService } from './itinerary-booking-links.service';

const PATH = '/api/itineraries/{id}/days/{dayId}/bookings';

@ApiTags('Itineraries - Bookings')
@ApiCookieAuth()
@ApiItineraryAuth(PATH)
@Controller('itineraries')
export class ItineraryBookingLinksController {
  constructor(private readonly links: ItineraryBookingLinksService) {}

  @Post(':id/days/:dayId/bookings')
  @ApiOperation({
    summary:
      'Link a confirmed flight or hotel booking to an itinerary day (ITN-27)',
    description:
      'The booking must be yours and CONFIRMED or COMPLETED. Its total is ' +
      'snapshotted into the day and counted in the budget (hotel as ' +
      'accommodation, flight as intercity transport).',
  })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiErrorResponse(notFoundError(PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  link(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: LinkBookingDto,
  ) {
    return this.links.link(user, id, dayId, dto);
  }

  @Delete(':id/days/:dayId/bookings/:bookingType/:bookingId')
  @ApiOperation({ summary: 'Unlink a booking from an itinerary day (ITN-27)' })
  @ApiOkResponse({ description: 'The updated itinerary' })
  @ApiErrorResponse(notFoundError(PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  unlink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Param('bookingType') bookingType: string,
    @Param('bookingId') bookingId: string,
  ) {
    return this.links.unlink(user, id, dayId, bookingType, bookingId);
  }
}
