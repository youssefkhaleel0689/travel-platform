import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
import { unauthenticated } from '../../common/swagger/standard-errors';
import { AirlineBookingsService } from './airline-bookings.service';
import {
  AirlineFlightBookingsDto,
  ListFlightBookingsQueryDto,
} from './dto/airline-flight-bookings.dto';

const FLIGHT_ID_EXAMPLE = '6720f1c2a1b2c3d4e5f60718';
const LIST_PATH = `/api/flights/${FLIGHT_ID_EXAMPLE}/bookings`;
const EXPORT_PATH = `/api/flights/${FLIGHT_ID_EXAMPLE}/passengers/export`;

const forbiddenErrors = (path: string) =>
  ApiErrorResponse({
    status: 403,
    description:
      'Not an airline moderator (FORBIDDEN), or a moderator with no airline assigned (NO_AIRLINE_ASSIGNED)',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to do this',
        path,
      },
      {
        code: 'NO_AIRLINE_ASSIGNED',
        message: 'You are not assigned to an airline',
        path,
      },
    ],
  });

const flightNotFound = (path: string) =>
  ApiErrorResponse({
    status: 404,
    description:
      "No flight of your airline has this id (FLIGHT_NOT_FOUND). Another airline's flight answers the same, so ids cannot be probed",
    examples: [
      {
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight not found',
        path,
      },
    ],
  });

// FLT-29: the airline moderator's view of who is booked on a flight of their airline.
@ApiTags('Flights')
@ApiCookieAuth('access_token')
@Controller('flights')
export class AirlineBookingsController {
  constructor(private readonly bookings: AirlineBookingsService) {}

  @Get(':id/bookings')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Bookings of one of your flights (FLT-29, airline moderator)',
    description:
      'Each booking shows its reference, the passenger names, the cabin, the seats it ' +
      'takes and its status (CONFIRMED, COMPLETED or CANCELLED), 10 per page, oldest ' +
      'first. The response also lists the seats remaining per cabin category. Only ' +
      'flights of your own airline are visible; the airline comes from your assignment. ' +
      'Passport and ID numbers are never returned.',
  })
  @ApiParam({ name: 'id', example: FLIGHT_ID_EXAMPLE })
  @ApiOkResponse({ type: AirlineFlightBookingsDto })
  @ApiErrorResponse({
    status: 400,
    description: 'The page or the status filter is invalid',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: `${LIST_PATH}?status=PENDING_PAYMENT`,
        errors: [
          {
            field: 'status',
            messages: [
              'status must be one of the following values: CONFIRMED, COMPLETED, CANCELLED',
            ],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse(unauthenticated(LIST_PATH))
  @forbiddenErrors(LIST_PATH)
  @flightNotFound(LIST_PATH)
  list(
    @Param('id') id: string,
    @Query() query: ListFlightBookingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AirlineFlightBookingsDto> {
    return this.bookings.list(id, query, user);
  }

  @Get(':id/passengers/export')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Passenger list of one of your flights as CSV (FLT-29)',
    description:
      'One row per passenger of the CONFIRMED and COMPLETED bookings: booking reference, ' +
      'name, passenger type, date of birth, cabin, whether the passenger needs a seat and ' +
      'the booking status. Cancelled bookings are left out. Passport and ID numbers are ' +
      'not exported. In Swagger UI use "Download file" in the response.',
  })
  @ApiParam({ name: 'id', example: FLIGHT_ID_EXAMPLE })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The CSV file (UTF-8 with BOM, CRLF line ends)',
    content: {
      'text/csv': {
        schema: { type: 'string' },
        example:
          'Booking reference,Passenger name,Passenger type,Date of birth,Cabin,Needs a seat,Booking status\r\nK7M2QX,Amira Hassan,ADULT,1990-05-04,ECONOMY,YES,CONFIRMED\r\n',
      },
    },
  })
  @ApiErrorResponse(unauthenticated(EXPORT_PATH))
  @forbiddenErrors(EXPORT_PATH)
  @flightNotFound(EXPORT_PATH)
  async export(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const { filename, csv } = await this.bookings.exportPassengers(id, user);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
