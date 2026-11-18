import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
} from '../../common/swagger/standard-errors';
import {
  CancelFlightBookingDto,
  CancellationQuoteDto,
  CancelledFlightBookingDto,
  ListMyFlightBookingsQueryDto,
  MyFlightBookingsDto,
} from './dto/my-flight-bookings.dto';
import { MyFlightBookingsService } from './my-flight-bookings.service';

const BOOKING_ID_EXAMPLE = '6720f1c2a1b2c3d4e5f60720';
const LIST_PATH = '/api/flight-bookings';
const QUOTE_PATH = `/api/flight-bookings/${BOOKING_ID_EXAMPLE}/cancellation-quote`;
const CANCEL_PATH = `/api/flight-bookings/${BOOKING_ID_EXAMPLE}/cancel`;

const bookingNotFound = (path: string) =>
  ApiErrorResponse({
    status: 404,
    description:
      "No booking of yours has this id (BOOKING_NOT_FOUND). Another account's booking answers the same, so ids cannot be probed",
    examples: [
      { code: 'BOOKING_NOT_FOUND', message: 'Booking not found', path },
    ],
  });

// FLT-25 (my bookings) and FLT-26 (cancel). Registered users only (ACC-11). The booking
// summary, the hold and GET /api/flight-bookings/{id} (details) are the booking module's.
@ApiTags('Flight bookings')
@ApiCookieAuth('access_token')
@Controller('flight-bookings')
export class MyFlightBookingsController {
  constructor(private readonly bookings: MyFlightBookingsService) {}

  @Get()
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'My flight bookings: upcoming, past, cancelled (FLT-25)',
    description:
      'One group per request (?group=UPCOMING | PAST | CANCELLED, default UPCOMING), 10 ' +
      'per page, plus how many bookings each group holds. UPCOMING: paid with a flight ' +
      'still ahead, soonest first. PAST: completed, or every flight has left, latest ' +
      'first. CANCELLED: cancelled by you or by the airline, with the refund. Unpaid ' +
      'holds are not listed. Open one with GET /api/flight-bookings/{id}.',
  })
  @ApiOkResponse({ type: MyFlightBookingsDto })
  @ApiErrorResponse({
    status: 400,
    description: 'The group or the page is invalid',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: `${LIST_PATH}?group=SOON`,
        errors: [
          {
            field: 'group',
            messages: [
              'group must be one of the following values: UPCOMING, PAST, CANCELLED',
            ],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse(unauthenticated(LIST_PATH))
  @ApiErrorResponse(forbidden(LIST_PATH))
  list(
    @Query() query: ListMyFlightBookingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyFlightBookingsDto> {
    return this.bookings.list(query, user);
  }

  @Get(':id/cancellation-quote')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'What cancelling would refund (FLT-26, FLT-09)',
    description:
      "Shows the refund before you confirm: the airline tier of this booking's own " +
      'policy snapshot for the whole days left until the first flight, and the amount. ' +
      'canCancel is false (with blockedReason) when the booking is not CONFIRMED or ' +
      'its first flight has left. Nothing is changed.',
  })
  @ApiParam({ name: 'id', example: BOOKING_ID_EXAMPLE })
  @ApiOkResponse({ type: CancellationQuoteDto })
  @ApiErrorResponse(unauthenticated(QUOTE_PATH))
  @ApiErrorResponse(forbidden(QUOTE_PATH))
  @bookingNotFound(QUOTE_PATH)
  cancellationQuote(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CancellationQuoteDto> {
    return this.bookings.cancellationQuote(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Cancel my CONFIRMED flight booking (FLT-26)',
    description:
      'Only a CONFIRMED booking whose first flight has not left. The booking becomes ' +
      'CANCELLED, its seats go back to the flight and the refund of the tier that ' +
      'applies today (GET .../cancellation-quote) is requested (PAY-03). A round trip ' +
      'is cancelled as a whole. The status is never sent by the client. A failed refund ' +
      'does not undo the cancellation: it is kept as FAILED and can be retried.',
  })
  @ApiParam({ name: 'id', example: BOOKING_ID_EXAMPLE })
  @ApiBody({ type: CancelFlightBookingDto })
  @ApiOkResponse({ type: CancelledFlightBookingDto })
  @ApiErrorResponse({
    status: 400,
    description: 'The reason is invalid',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: CANCEL_PATH,
        errors: [
          {
            field: 'reason',
            messages: [
              'reason must be shorter than or equal to 500 characters',
            ],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse(unauthenticated(CANCEL_PATH))
  @ApiErrorResponse(forbidden(CANCEL_PATH))
  @bookingNotFound(CANCEL_PATH)
  @ApiErrorResponse({
    status: 409,
    description:
      'The booking is not CONFIRMED (BOOKING_NOT_CANCELLABLE: unpaid, expired, completed or already cancelled), or its first flight has left (DEPARTURE_PASSED)',
    examples: [
      {
        code: 'BOOKING_NOT_CANCELLABLE',
        message: 'A CANCELLED booking cannot be cancelled',
        path: CANCEL_PATH,
      },
      {
        code: 'DEPARTURE_PASSED',
        message: 'This booking can no longer be cancelled: its flight has left',
        path: CANCEL_PATH,
      },
    ],
  })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelFlightBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CancelledFlightBookingDto> {
    return this.bookings.cancel(id, dto, user);
  }
}
