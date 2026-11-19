import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import {
  BookingLinkDto,
  EXAMPLE_BOOKING_LINK_ID,
  LinkBookingDto,
} from './dto/booking-link.dto';
import {
  BOOKING_ALREADY_LINKED,
  BOOKING_LINK_NOT_FOUND,
  BOOKING_NOT_CONFIRMED,
  BOOKING_NOT_FOUND,
  ItineraryBookingsService,
} from './itinerary-bookings.service';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  badRequestError,
  DAY_NOT_FOUND_EXAMPLE,
  ITINERARY_NOT_FOUND_EXAMPLE,
  ITINERARY_PATH,
  notFoundError,
} from './itinerary-api-docs';

const LINKS = `${ITINERARY_PATH}/bookings`;
const LINK = `${LINKS}/${EXAMPLE_BOOKING_LINK_ID}`;

// ITN-27 (bonus): booked flights and hotels linked to itinerary days, feeding
// the budget (GET /api/itineraries/{id}/budget-summary shows them).
@ApiTags('Itineraries - Budget')
@ApiItineraryAuth(LINKS)
@Controller('itineraries')
export class ItineraryBookingsController {
  constructor(private readonly links: ItineraryBookingsService) {}

  @Post(':id/bookings')
  @ApiOperation({
    summary: 'Link one of your bookings to a day (ITN-27, bonus)',
    description:
      'Only your own CONFIRMED or COMPLETED flight or hotel bookings, each at most ' +
      'once per itinerary. Its price then shows in the budget summary, in the ' +
      'platform currency (bookings are never converted, ITN-18).',
  })
  @ApiCreatedResponse({ type: BookingLinkDto })
  @ApiErrorResponse(
    badRequestError(LINKS, [
      {
        field: 'bookingType',
        messages: [
          'bookingType must be one of the following values: FLIGHT, HOTEL',
        ],
      },
    ]),
  )
  @ApiErrorResponse(
    notFoundError(
      LINKS,
      ITINERARY_NOT_FOUND_EXAMPLE,
      DAY_NOT_FOUND_EXAMPLE,
      BOOKING_NOT_FOUND,
    ),
  )
  @ApiErrorResponse({
    status: 409,
    description:
      'The booking is not CONFIRMED or COMPLETED, or it is already linked to this itinerary',
    examples: [
      { ...BOOKING_NOT_CONFIRMED, path: LINKS },
      { ...BOOKING_ALREADY_LINKED, path: LINKS },
    ],
  })
  link(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LinkBookingDto,
  ): Promise<BookingLinkDto> {
    return this.links.link(user, id, dto);
  }

  @Get(':id/bookings')
  @ApiOperation({
    summary: 'List the bookings linked to your itinerary (ITN-27, bonus)',
    description:
      'In day order. Status and price are read live from each booking, so a ' +
      'cancelled booking shows as such and stops counting in the budget.',
  })
  @ApiOkResponse({ type: [BookingLinkDto] })
  @ApiErrorResponse(notFoundError(LINKS, ITINERARY_NOT_FOUND_EXAMPLE))
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<BookingLinkDto[]> {
    return this.links.list(user, id);
  }

  @Delete(':id/bookings/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unlink a booking from your itinerary (ITN-27, bonus)',
    description: 'The booking itself is not changed or cancelled.',
  })
  @ApiNoContentResponse({ description: 'Unlinked' })
  @ApiErrorResponse(
    notFoundError(LINK, ITINERARY_NOT_FOUND_EXAMPLE, BOOKING_LINK_NOT_FOUND),
  )
  async unlink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    await this.links.unlink(user, id, linkId);
  }
}
