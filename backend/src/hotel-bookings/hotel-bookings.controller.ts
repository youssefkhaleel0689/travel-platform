import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  CancelBookingDto,
  CreateHotelBookingDto,
  ListBookingsQueryDto,
  ReservationsQueryDto,
} from './dto/hotel-booking.dto';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { Role } from '../common/auth/auth.enums';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';

const BOOKINGS = '/api/hotel-bookings';
const BOOKING = '/api/hotel-bookings/6af8b9fdbc5624b5a1b41d6b';
const PREVIEW = `${BOOKING}/cancellation-preview`;
const CANCEL = `${BOOKING}/cancel`;
const RESERVATIONS = '/api/hotels/6af83761fa40574d39eb7dc2/reservations';
const UNAUTH = { code: 'UNAUTHENTICATED', message: 'Authentication required' };
const FORBIDDEN = {
  code: 'FORBIDDEN',
  message: 'You do not have permission to do this',
};
const VALIDATION = {
  code: 'VALIDATION_FAILED',
  message: 'Validation failed',
  errors: [{ field: 'body', messages: ['invalid value'] }],
};
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Hotel booking not found' };

@ApiTags('Hotel bookings (B2)')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly service: HotelBookingsService) {}

  @Post()
  @ApiOkResponse({ description: 'The held reservation (PENDING_PAYMENT)' })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed (VALIDATION_FAILED)',
    examples: [{ ...VALIDATION, path: BOOKINGS }],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: BOOKINGS }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: BOOKINGS }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Hotel not found (HOTEL_NOT_FOUND)',
    examples: [
      { code: 'HOTEL_NOT_FOUND', message: 'Hotel not found', path: BOOKINGS },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description:
      'One or more rooms are not available; nothing was held (ROOM_UNAVAILABLE)',
    examples: [
      {
        code: 'ROOM_UNAVAILABLE',
        message:
          'Not available for the whole stay, nothing was held: room 101 (BOOKED)',
        path: BOOKINGS,
      },
    ],
  })
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'HTL-16/18 Create a hotel booking (USER)',
    description:
      'Access: USER only — login required. Creates one reservation for one or more rooms and holds all requested rooms together for 10 minutes in PENDING_PAYMENT. The authenticated user is the booking owner.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHotelBookingDto,
  ) {
    return this.service.createHold(user, dto);
  }

  @Get()
  @ApiOkResponse({
    description: 'Paginated bookings grouped by UPCOMING / PAST / CANCELLED',
  })
  @ApiErrorResponse({
    status: 400,
    description: 'Invalid query (VALIDATION_FAILED)',
    examples: [{ ...VALIDATION, path: BOOKINGS }],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: BOOKINGS }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: BOOKINGS }],
  })
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'HTL-20 List my hotel bookings (USER)',
    description:
      "Access: USER only — login required. Returns only the authenticated user's hotel reservations, grouped into UPCOMING, PAST and CANCELLED, with pagination.",
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: ListBookingsQueryDto,
  ) {
    return this.service.listMine(user, q);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'The booking details' })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: BOOKING }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: BOOKING }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Booking not found (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: BOOKING }],
  })
  @Roles(Role.USER, Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'HTL-20 Get hotel booking details (USER / ADMIN / HOTEL_MODERATOR)',
    description:
      'Access: USER, ADMIN or HOTEL_MODERATOR — login required. USER may view only their own booking; ADMIN may view any booking; HOTEL_MODERATOR may view bookings for their assigned hotel only.',
  })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findOneFor(user, id);
  }

  @Get(':id/cancellation-preview')
  @ApiOkResponse({
    description: 'Refund percentage and amount; nothing is cancelled',
  })
  @ApiErrorResponse({
    status: 400,
    description: 'Booking cannot be cancelled (BAD_REQUEST)',
    examples: [
      {
        code: 'BAD_REQUEST',
        message: 'Only CONFIRMED reservations can be cancelled',
        path: PREVIEW,
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: PREVIEW }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: PREVIEW }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Booking not found (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: PREVIEW }],
  })
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'HTL-21 Preview hotel booking cancellation (booking owner USER)',
    description:
      'Access: USER only — login required. Calculates the cancellation refund percentage and amount using the policy snapshot taken at booking time; does not cancel the booking.',
  })
  preview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancellationPreview(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ description: 'The cancelled booking with refund details' })
  @ApiErrorResponse({
    status: 400,
    description: 'Booking cannot be cancelled (BAD_REQUEST)',
    examples: [
      {
        code: 'BAD_REQUEST',
        message: 'Only CONFIRMED reservations can be cancelled',
        path: CANCEL,
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: CANCEL }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: CANCEL }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Booking not found (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: CANCEL }],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'Booking was already cancelled or changed (CONFLICT)',
    examples: [
      {
        code: 'CONFLICT',
        message: 'Reservation was already cancelled or changed',
        path: CANCEL,
      },
    ],
  })
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'HTL-21 Cancel a hotel booking (booking owner USER)',
    description:
      'Access: USER only — login required. The caller must own the booking and set body.confirm to true. Cancels the entire reservation and applies the cancellation/refund rules.',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.service.cancel(user, id, dto);
  }
}

@ApiTags('Hotel bookings (B2)')
@ApiCookieAuth()
@Controller('hotels/:hotelId/reservations')
export class HotelReservationsController {
  constructor(private readonly service: HotelBookingsService) {}

  @Get()
  @ApiOkResponse({ description: 'Paginated reservations for the hotel' })
  @ApiErrorResponse({
    status: 400,
    description: 'Invalid query (VALIDATION_FAILED)',
    examples: [{ ...VALIDATION, path: RESERVATIONS }],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: RESERVATIONS }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role or not assigned to this hotel (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: RESERVATIONS }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Hotel not found (HOTEL_NOT_FOUND)',
    examples: [
      {
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
        path: RESERVATIONS,
      },
    ],
  })
  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @ApiOperation({
    summary: 'HTL-22 List hotel reservations (HOTEL_MODERATOR or ADMIN)',
    description:
      'Access: HOTEL_MODERATOR or ADMIN — login required. Returns reservation guest details, dates and statuses.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hotelId') hotelId: string,
    @Query() q: ReservationsQueryDto,
  ) {
    return this.service.listForHotel(user, hotelId, q);
  }
}
