import {
  applyDecorators,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import {
  ApiErrorResponse,
  ApiErrorResponseOptions,
} from '../../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
} from '../../common/swagger/standard-errors';
import { FlightBookingRequestDto } from './dto/flight-booking-request.dto';
import {
  FlightBookingDto,
  FlightBookingSummaryDto,
} from './dto/flight-booking-response.dto';
import { FlightBookingsService } from './flight-bookings.service';

const SUMMARY_PATH = '/api/flight-bookings';
const HOLD_PATH = '/api/flight-bookings/hold';

// The errors the summary and the hold share: both check the same request against the
// same flights (FLT-19, FLT-21, FLT-22).
export function bookingRequestErrors(path: string): ApiErrorResponseOptions[] {
  return [
    {
      status: 400,
      description:
        'Validation failed, a passenger type that does not match the date of birth, a ' +
        'cabin the flight does not have, a return flight that does not fit the outbound ' +
        'one, or extra bags the airline or cabin does not allow',
      examples: [
        {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          path,
          errors: [
            {
              field: 'passengers',
              messages: ['passengers must not have more infants than adults'],
            },
          ],
        },
        {
          code: 'PASSENGER_TYPE_MISMATCH',
          message:
            'Passenger types must match their dates of birth on the departure date',
          path,
          errors: [
            {
              field: 'passengers.1.passengerType',
              messages: [
                'passengerType must be CHILD for someone born on 2018-01-01 (age on 2026-12-20)',
              ],
            },
          ],
        },
        {
          code: 'CABIN_NOT_OFFERED',
          message: 'This flight has no FIRST cabin',
          path,
          errors: [
            {
              field: 'outbound.cabin',
              messages: ['This flight has no FIRST cabin'],
            },
          ],
        },
        {
          code: 'ROUND_TRIP_ROUTE_MISMATCH',
          message: 'inbound must fly from DXB to CAI',
          path,
          errors: [
            {
              field: 'inbound.flightId',
              messages: ['inbound must fly from DXB to CAI'],
            },
          ],
        },
        {
          code: 'RETURN_BEFORE_ARRIVAL',
          message: 'inbound must leave after the outbound flight lands',
          path,
          errors: [
            {
              field: 'inbound.flightId',
              messages: ['inbound must leave after the outbound flight lands'],
            },
          ],
        },
        {
          code: 'EXTRA_BAGS_NOT_ALLOWED',
          message:
            "Extra bags must fit the airline's policy and the cabin's bag weight",
          path,
          errors: [
            {
              field: 'passengers.0.extraBags',
              messages: ['this airline does not sell extra bags'],
            },
          ],
        },
      ],
    },
    unauthenticated(path),
    forbidden(path),
    {
      status: 404,
      description: 'No flight has this id (FLIGHT_NOT_FOUND)',
      examples: [
        {
          code: 'FLIGHT_NOT_FOUND',
          message: 'Flight not found',
          path,
          errors: [
            { field: 'outbound.flightId', messages: ['no flight has this id'] },
          ],
        },
      ],
    },
    {
      status: 409,
      description:
        'The flight is cancelled, has departed or its airline is deactivated ' +
        '(FLIGHT_NOT_BOOKABLE), or the cabin has fewer free seats than adults and ' +
        'children (SEAT_UNAVAILABLE)',
      examples: [
        {
          code: 'FLIGHT_NOT_BOOKABLE',
          message: 'This flight can no longer be booked',
          path,
          errors: [
            {
              field: 'outbound.flightId',
              messages: ['this flight can no longer be booked'],
            },
          ],
        },
        {
          code: 'SEAT_UNAVAILABLE',
          message: 'Only 1 seat left in ECONOMY',
          path,
          errors: [
            {
              field: 'outbound.cabin',
              messages: ['Only 1 seat left in ECONOMY'],
            },
          ],
        },
      ],
    },
  ];
}

function ApiBookingRequestErrors(path: string): MethodDecorator {
  return applyDecorators(
    ...bookingRequestErrors(path).map((options) => ApiErrorResponse(options)),
  );
}

// FLT-19, FLT-21, FLT-22: booking a flight. Registered users only (ACC-11).
@ApiTags('Flight bookings')
@ApiCookieAuth('access_token')
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly bookings: FlightBookingsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Booking summary before payment (FLT-19, FLT-21)',
    description:
      'Checks the passengers and extra bags against the chosen flights and returns ' +
      'each segment, each passenger with their fare (infants pay 10%), the airline ' +
      'policy and the total. Nothing is stored and no seat is held: send the same body ' +
      'to POST /api/flight-bookings/hold to hold the seats.',
  })
  @ApiBody({ type: FlightBookingRequestDto })
  @ApiOkResponse({ type: FlightBookingSummaryDto })
  @ApiBookingRequestErrors(SUMMARY_PATH)
  summarize(
    @Body() dto: FlightBookingRequestDto,
  ): Promise<FlightBookingSummaryDto> {
    return this.bookings.summarize(dto);
  }

  @Post('hold')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Hold the seats for 10 minutes (FLT-22)',
    description:
      'Same body as the summary. In one transaction it checks and prices the request ' +
      'again, holds a seat per adult and child on every segment and creates the booking ' +
      'in PENDING_PAYMENT with holdExpiresAt 10 minutes ahead. If any segment is full, ' +
      'no seat is held at all. Then accept the policies (GET and POST ' +
      '/api/bookings/flight/{id}/policies) and pay (POST /api/payments). An unpaid hold ' +
      'expires and its seats are released.',
  })
  @ApiBody({ type: FlightBookingRequestDto })
  @ApiCreatedResponse({ type: FlightBookingDto })
  @ApiBookingRequestErrors(HOLD_PATH)
  hold(
    @Body() dto: FlightBookingRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightBookingDto> {
    return this.bookings.hold(dto, user);
  }
}
