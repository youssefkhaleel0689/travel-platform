import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightDto } from './dto/flight.dto';
import { FlightsService } from './flights.service';

// FLT-03: flights. Later PRs add cabins (FLT-04), edit (FLT-05) and cancel (FLT-06).
@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Post()
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create a flight for your airline (FLT-03, airline moderator)',
    description:
      'The airline is the one you are assigned to; it is never sent in the body. ' +
      'Airports must be seeded airports (GET /api/airports). Departure and arrival are ' +
      "entered in each airport's local time (YYYY-MM-DDTHH:mm) and stored in UTC. " +
      'The flight starts SCHEDULED with no cabins (FLT-04 adds them).',
  })
  @ApiBody({ type: CreateFlightDto })
  @ApiCreatedResponse({ type: FlightDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'Validation failed, or a flight rule was broken (identical airports, unknown airport, ' +
      'a local time that does not exist, departure in the past, arrival not after departure)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/flights',
        errors: [
          {
            field: 'departureLocalInput',
            messages: [
              'departureLocalInput must be a valid local date and time (YYYY-MM-DDTHH:mm)',
            ],
          },
        ],
      },
      {
        code: 'SAME_AIRPORTS',
        message: 'arrivalAirportId must differ from departureAirportId',
        path: '/api/flights',
        errors: [
          {
            field: 'arrivalAirportId',
            messages: ['arrivalAirportId must differ from departureAirportId'],
          },
        ],
      },
      {
        code: 'UNKNOWN_AIRPORT',
        message: 'Unknown airport: XXX',
        path: '/api/flights',
      },
      {
        code: 'NONEXISTENT_LOCAL_TIME',
        message:
          '2027-04-30T00:30 does not exist in Africa/Cairo (clocks move forward)',
        path: '/api/flights',
        errors: [
          {
            field: 'departureLocalInput',
            messages: [
              '2027-04-30T00:30 does not exist in Africa/Cairo (clocks move forward)',
            ],
          },
        ],
      },
      {
        code: 'DEPARTURE_IN_PAST',
        message: 'Departure must be in the future',
        path: '/api/flights',
        errors: [
          {
            field: 'departureLocalInput',
            messages: ['Departure must be in the future'],
          },
        ],
      },
      {
        code: 'ARRIVAL_NOT_AFTER_DEPARTURE',
        message: 'Arrival must be after departure',
        path: '/api/flights',
        errors: [
          {
            field: 'arrivalLocalInput',
            messages: ['Arrival must be after departure'],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description:
      'Not logged in, or the session is no longer valid (UNAUTHENTICATED)',
    examples: [
      {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        path: '/api/flights',
      },
    ],
  })
  @ApiErrorResponse({
    status: 403,
    description:
      'Not an airline moderator (FORBIDDEN), or a moderator with no airline assigned (NO_AIRLINE_ASSIGNED)',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
        path: '/api/flights',
      },
      {
        code: 'NO_AIRLINE_ASSIGNED',
        message: 'You are not assigned to an airline',
        path: '/api/flights',
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description:
      'Your airline already has this flight number on this departure date (FLIGHT_ALREADY_EXISTS)',
    examples: [
      {
        code: 'FLIGHT_ALREADY_EXISTS',
        message:
          'This airline already has a flight with this number on this departure date',
        path: '/api/flights',
        errors: [
          {
            field: 'flightNumber',
            messages: ['already used on this departure date'],
          },
        ],
      },
    ],
  })
  create(
    @Body() dto: CreateFlightDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightDto> {
    return this.flights.create(dto, user);
  }
}
