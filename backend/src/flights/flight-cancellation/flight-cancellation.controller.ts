import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { unauthenticated } from '../../common/swagger/standard-errors';
import {
  CancelFlightDto,
  CancelledFlightResultDto,
} from './dto/cancel-flight.dto';
import { FlightCancellationService } from './flight-cancellation.service';

const CANCEL_PATH = '/api/flights/6720f1c2a1b2c3d4e5f60718/cancel';

// FLT-06: an airline moderator cancels one of the airline's flights.
@ApiTags('Flights')
@ApiCookieAuth('access_token')
@Controller('flights')
export class FlightCancellationController {
  constructor(private readonly cancellation: FlightCancellationService) {}

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Cancel one of your flights (FLT-06, airline moderator)',
    description:
      'Send {"confirm": true} to confirm. A SCHEDULED flight of your airline that has not ' +
      'departed becomes CANCELLED and disappears from search. Every CONFIRMED booking on ' +
      'it becomes CANCELLED with a full (100%) refund and its seats go back; a round trip ' +
      'is cancelled as a whole. Unpaid holds are released. Each passenger gets an ' +
      'in-app notice. A failed refund does not undo the cancellation: it is kept on ' +
      'record and can be retried (refundsFailed counts them).',
  })
  @ApiParam({ name: 'id', example: '6720f1c2a1b2c3d4e5f60718' })
  @ApiBody({ type: CancelFlightDto })
  @ApiOkResponse({ type: CancelledFlightResultDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'The confirmation is missing or not true, or the reason is invalid',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: CANCEL_PATH,
        errors: [
          {
            field: 'confirm',
            messages: ['confirm must be true to cancel the flight'],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse(unauthenticated(CANCEL_PATH))
  @ApiErrorResponse({
    status: 403,
    description:
      'Not an airline moderator (FORBIDDEN), a moderator with no airline assigned (NO_AIRLINE_ASSIGNED), or an airline that is deactivated (AIRLINE_DEACTIVATED)',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
        path: CANCEL_PATH,
      },
      {
        code: 'NO_AIRLINE_ASSIGNED',
        message: 'You are not assigned to an airline',
        path: CANCEL_PATH,
      },
      {
        code: 'AIRLINE_DEACTIVATED',
        message: 'Your airline is deactivated and cannot cancel flights',
        path: CANCEL_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description:
      "No flight of your airline has this id (FLIGHT_NOT_FOUND). Another airline's flight answers the same",
    examples: [
      {
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight not found',
        path: CANCEL_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description:
      'The flight is already cancelled (FLIGHT_ALREADY_CANCELLED) or has departed (FLIGHT_ALREADY_DEPARTED), or it changed while being cancelled (FLIGHT_CHANGED)',
    examples: [
      {
        code: 'FLIGHT_ALREADY_CANCELLED',
        message: 'This flight is already cancelled',
        path: CANCEL_PATH,
      },
      {
        code: 'FLIGHT_ALREADY_DEPARTED',
        message: 'This flight has already departed and cannot be cancelled',
        path: CANCEL_PATH,
      },
      {
        code: 'FLIGHT_CHANGED',
        message: 'The flight changed while it was being cancelled; try again',
        path: CANCEL_PATH,
      },
    ],
  })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelFlightDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CancelledFlightResultDto> {
    return this.cancellation.cancel(id, dto, user);
  }
}
