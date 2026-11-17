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
import { FlightDto } from '../flights/dto/flight.dto';
import { CabinCategory } from '../schemas/flight.schema';
import { CabinsService } from './cabins.service';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';

const FLIGHT_ID_EXAMPLE = '6720f1c2a1b2c3d4e5f60718';
const ADD_PATH = `/api/flights/${FLIGHT_ID_EXAMPLE}/cabins`;
const EDIT_PATH = `${ADD_PATH}/ECONOMY`;

const UNAUTHENTICATED = {
  code: 'UNAUTHENTICATED',
  message: 'Authentication required',
};
const FORBIDDEN = {
  code: 'FORBIDDEN',
  message: 'You do not have permission to do this',
};
const NO_AIRLINE = {
  code: 'NO_AIRLINE_ASSIGNED',
  message: 'You are not assigned to an airline',
};
const AIRLINE_DEACTIVATED = {
  code: 'AIRLINE_DEACTIVATED',
  message: 'Your airline is deactivated and cannot change its flights',
};
const FLIGHT_NOT_FOUND = {
  code: 'FLIGHT_NOT_FOUND',
  message: 'Flight not found',
};
const NOT_SCHEDULED = {
  code: 'FLIGHT_NOT_SCHEDULED',
  message: 'Only a SCHEDULED flight can be changed (this one is CANCELLED)',
};
const DEPARTED = {
  code: 'FLIGHT_ALREADY_DEPARTED',
  message: 'This flight has already departed and can no longer be changed',
};

// FLT-04: the cabins of a flight. Seat-count edits and the time-change notices come with
// FLT-05. The flight id is the path :id; cabins have no _id of their own (schema section 3),
// so the cabin in the path is its category.
@ApiTags('Cabins')
@Controller('flights/:id/cabins')
export class CabinsController {
  constructor(private readonly cabins: CabinsService) {}

  @Post()
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Add a cabin to a flight of your airline (FLT-04, airline moderator)',
    description:
      'Categories are ECONOMY, PREMIUM_ECONOMY, BUSINESS and FIRST, each once per flight. ' +
      'The flight must belong to your airline, be SCHEDULED and not have departed. ' +
      'bookedSeats and heldSeats start at 0 and cannot be sent. Returns the whole flight.',
  })
  @ApiParam({
    name: 'id',
    description: 'Flight id',
    example: FLIGHT_ID_EXAMPLE,
  })
  @ApiBody({ type: CreateCabinDto })
  @ApiCreatedResponse({ type: FlightDto })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: ADD_PATH,
        errors: [
          {
            field: 'totalSeats',
            messages: ['totalSeats must be greater than 0'],
          },
          { field: 'price', messages: ['price must be greater than 0'] },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in, or the session is no longer valid',
    examples: [{ ...UNAUTHENTICATED, path: ADD_PATH }],
  })
  @ApiErrorResponse({
    status: 403,
    description:
      'Not an airline moderator (FORBIDDEN), a moderator with no airline assigned (NO_AIRLINE_ASSIGNED), or an airline that is deactivated (AIRLINE_DEACTIVATED)',
    examples: [
      { ...FORBIDDEN, path: ADD_PATH },
      { ...NO_AIRLINE, path: ADD_PATH },
      { ...AIRLINE_DEACTIVATED, path: ADD_PATH },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description:
      'No such flight, or it belongs to another airline (FLIGHT_NOT_FOUND)',
    examples: [{ ...FLIGHT_NOT_FOUND, path: ADD_PATH }],
  })
  @ApiErrorResponse({
    status: 409,
    description:
      'The category is already defined (CABIN_ALREADY_EXISTS), or the flight is not SCHEDULED or has departed',
    examples: [
      {
        code: 'CABIN_ALREADY_EXISTS',
        message: 'This flight already has a ECONOMY cabin',
        path: ADD_PATH,
        errors: [
          { field: 'category', messages: ['already defined for this flight'] },
        ],
      },
      { ...NOT_SCHEDULED, path: ADD_PATH },
      { ...DEPARTED, path: ADD_PATH },
    ],
  })
  add(
    @Param('id') id: string,
    @Body() dto: CreateCabinDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightDto> {
    return this.cabins.add(id, dto, user);
  }

  @Patch(':cabinId')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Change the price or baggage of a cabin (FLT-04, FLT-05, airline moderator)',
    description:
      'Send any of price, freeBaggageCount, maxBagWeightKg. A price change does not affect ' +
      'existing bookings. The seat count is changed in a later PR (FLT-05). The cabin is ' +
      'identified by its category in the path.',
  })
  @ApiParam({
    name: 'id',
    description: 'Flight id',
    example: FLIGHT_ID_EXAMPLE,
  })
  @ApiParam({
    name: 'cabinId',
    description: 'Cabin category',
    enum: CabinCategory,
    example: CabinCategory.ECONOMY,
  })
  @ApiBody({ type: UpdateCabinDto })
  @ApiOkResponse({ type: FlightDto })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed, or nothing to change (EMPTY_UPDATE)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: EDIT_PATH,
        errors: [
          { field: 'price', messages: ['price must be greater than 0'] },
        ],
      },
      {
        code: 'EMPTY_UPDATE',
        message: 'Send at least one of price, freeBaggageCount, maxBagWeightKg',
        path: EDIT_PATH,
        errors: [
          {
            field: 'body',
            messages: [
              'send at least one of price, freeBaggageCount, maxBagWeightKg',
            ],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in, or the session is no longer valid',
    examples: [{ ...UNAUTHENTICATED, path: EDIT_PATH }],
  })
  @ApiErrorResponse({
    status: 403,
    description:
      'Not an airline moderator (FORBIDDEN), a moderator with no airline assigned (NO_AIRLINE_ASSIGNED), or an airline that is deactivated (AIRLINE_DEACTIVATED)',
    examples: [
      { ...FORBIDDEN, path: EDIT_PATH },
      { ...NO_AIRLINE, path: EDIT_PATH },
      { ...AIRLINE_DEACTIVATED, path: EDIT_PATH },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description:
      'No such flight or it belongs to another airline (FLIGHT_NOT_FOUND), or the flight has no such cabin (CABIN_NOT_FOUND)',
    examples: [
      { ...FLIGHT_NOT_FOUND, path: EDIT_PATH },
      {
        code: 'CABIN_NOT_FOUND',
        message: 'This flight has no ECONOMY cabin',
        path: EDIT_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'The flight is not SCHEDULED or has already departed',
    examples: [
      { ...NOT_SCHEDULED, path: EDIT_PATH },
      { ...DEPARTED, path: EDIT_PATH },
    ],
  })
  update(
    @Param('id') id: string,
    @Param('cabinId') cabinId: string,
    @Body() dto: UpdateCabinDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightDto> {
    return this.cabins.update(id, cabinId, dto, user);
  }
}
