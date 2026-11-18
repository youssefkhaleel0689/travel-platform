import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
import { FlightDetailsDto } from './dto/flight-details-response.dto';
import { FlightDetailsService } from './flight-details.service';

// FLT-17: the flight details page, for guests and registered users.
//
// This controller must be registered after FlightSearchController (flights.module.ts):
// routes match in registration order, and GET /flights/:id registered first would take
// GET /flights/search as a flight with the id "search".
@ApiTags('Flights')
@Controller('flights')
export class FlightDetailsController {
  constructor(private readonly flightDetails: FlightDetailsService) {}

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Flight details (FLT-17)',
    description:
      'Airline, flight number, airports, local departure and arrival times, duration, ' +
      'each cabin with its price, seats remaining and baggage allowance, and the ' +
      "airline's extra-bag price and cancellation tiers. Only flights of ACTIVE " +
      'airlines are shown; status says whether the flight can still be booked.',
  })
  @ApiOkResponse({ type: FlightDetailsDto })
  @ApiErrorResponse({
    status: 404,
    description:
      'No flight has this id, the id is malformed, or its airline is not active (FLIGHT_NOT_FOUND)',
    examples: [
      {
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight not found',
        path: '/api/flights/6720f1c2a1b2c3d4e5f60718',
      },
    ],
  })
  getDetails(@Param('id') id: string): Promise<FlightDetailsDto> {
    return this.flightDetails.getDetails(id);
  }
}
