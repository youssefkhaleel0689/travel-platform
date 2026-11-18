import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightDto } from './dto/flight.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { FlightsService } from './flights.service';

// FLT-03: create, FLT-05: edit. Cabins are FLT-04 (cabins controller); cancel is FLT-06.
const FLIGHT_ID_EXAMPLE = '6720f1c2a1b2c3d4e5f60718';
const EDIT_PATH = `/api/flights/${FLIGHT_ID_EXAMPLE}`;

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
      'Not an airline moderator (FORBIDDEN), a moderator with no airline assigned (NO_AIRLINE_ASSIGNED), or an airline that is deactivated (AIRLINE_DEACTIVATED)',
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
      {
        code: 'AIRLINE_DEACTIVATED',
        message: 'Your airline is deactivated and cannot add flights',
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

  @Patch(':id')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Edit the times or airports of a SCHEDULED flight of your airline (FLT-05, airline moderator)',
    description:
      'Send any of departureAirportId, arrivalAirportId, departureLocalInput, arrivalLocalInput. ' +
      "Times are on each airport's local clock (YYYY-MM-DDTHH:mm) and stored in UTC; the " +
      'departure date is recomputed. The airports can only change while no seat is booked or ' +
      'held (AIRPORTS_LOCKED); if you change an airport, send its local time too. Any change ' +
      'of a time sends an in-app notification to passengers with a CONFIRMED booking; existing ' +
      'bookings keep their own snapshot. Cabin prices and seat counts are changed with ' +
      'PATCH /api/flights/{id}/cabins/{cabinId}.',
  })
  @ApiParam({
    name: 'id',
    description: 'Flight id',
    example: FLIGHT_ID_EXAMPLE,
  })
  @ApiBody({ type: UpdateFlightDto })
  @ApiOkResponse({ type: FlightDto })
  @ApiErrorResponse({
    status: 400,
    description:
      'Validation failed, nothing to change (EMPTY_UPDATE), or a flight rule was broken (identical airports, unknown airport, a local time that does not exist, departure in the past, arrival not after departure, an airport changed without its local time)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: EDIT_PATH,
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
        code: 'EMPTY_UPDATE',
        message:
          'Send at least one of departureAirportId, arrivalAirportId, departureLocalInput, arrivalLocalInput',
        path: EDIT_PATH,
        errors: [
          {
            field: 'body',
            messages: [
              'send at least one of departureAirportId, arrivalAirportId, departureLocalInput, arrivalLocalInput',
            ],
          },
        ],
      },
      {
        code: 'LOCAL_TIME_REQUIRED',
        message:
          'Send departureLocalInput when you change the departure airport',
        path: EDIT_PATH,
        errors: [
          {
            field: 'departureLocalInput',
            messages: [
              'Send departureLocalInput when you change the departure airport',
            ],
          },
        ],
      },
      {
        code: 'SAME_AIRPORTS',
        message: 'arrivalAirportId must differ from departureAirportId',
        path: EDIT_PATH,
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
        path: EDIT_PATH,
      },
      {
        code: 'NONEXISTENT_LOCAL_TIME',
        message:
          '2027-04-30T00:30 does not exist in Africa/Cairo (clocks move forward)',
        path: EDIT_PATH,
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
        path: EDIT_PATH,
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
        path: EDIT_PATH,
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
        path: EDIT_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 403,
    description:
      'Not an airline moderator (FORBIDDEN), a moderator with no airline assigned (NO_AIRLINE_ASSIGNED), or an airline that is deactivated (AIRLINE_DEACTIVATED)',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
        path: EDIT_PATH,
      },
      {
        code: 'NO_AIRLINE_ASSIGNED',
        message: 'You are not assigned to an airline',
        path: EDIT_PATH,
      },
      {
        code: 'AIRLINE_DEACTIVATED',
        message: 'Your airline is deactivated and cannot change its flights',
        path: EDIT_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description:
      'No such flight, or it belongs to another airline (FLIGHT_NOT_FOUND)',
    examples: [
      {
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight not found',
        path: EDIT_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description:
      'The flight is not SCHEDULED or has already departed, the airports are locked by a booking or hold (AIRPORTS_LOCKED), the new departure date clashes with the same flight number (FLIGHT_ALREADY_EXISTS), or the flight was changed at the same time (FLIGHT_CHANGED)',
    examples: [
      {
        code: 'FLIGHT_NOT_SCHEDULED',
        message:
          'Only a SCHEDULED flight can be changed (this one is CANCELLED)',
        path: EDIT_PATH,
      },
      {
        code: 'FLIGHT_ALREADY_DEPARTED',
        message:
          'This flight has already departed and can no longer be changed',
        path: EDIT_PATH,
      },
      {
        code: 'AIRPORTS_LOCKED',
        message:
          'The airports cannot be changed once the flight has a booking or a seat hold',
        path: EDIT_PATH,
      },
      {
        code: 'FLIGHT_ALREADY_EXISTS',
        message:
          'This airline already has a flight with this number on the new departure date',
        path: EDIT_PATH,
        errors: [
          {
            field: 'departureLocalInput',
            messages: ['flight number already used on this departure date'],
          },
        ],
      },
      {
        code: 'FLIGHT_CHANGED',
        message: 'The flight was changed at the same time, please try again',
        path: EDIT_PATH,
      },
    ],
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFlightDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightDto> {
    return this.flights.update(id, dto, user);
  }
}
