import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, ValidateBy } from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { IATA_CODE } from '../../../common/reference-data/reference-data.patterns';
import { parseLocalDate } from '../../../common/time/local-date-time';
import { IsLocalDate } from '../../../common/time/local-date-time.validators';
import { trimUpper } from '../../airlines/dto/create-airline.dto';
import { TripType } from '../../flight-search/flight-search.constants';
import { FlightSearchQueryDto } from '../../flight-search/dto/flight-search-query.dto';

// The return date as ITN-26 takes it: optional even for a ROUND_TRIP, because the last
// day of the itinerary is the default. Each problem has its own message.
function returnDateProblem(
  value: unknown,
  args: ValidationArguments,
): string | null {
  if (value === undefined) {
    return null;
  }
  const query = args.object as { tripType?: unknown; departureDate?: unknown };
  if (query.tripType !== TripType.ROUND_TRIP) {
    return 'returnDate is only allowed for a ROUND_TRIP';
  }
  if (parseLocalDate(value) === null) {
    return 'returnDate must be a valid local date (YYYY-MM-DD)';
  }
  // YYYY-MM-DD strings sort like the dates they name.
  if (
    parseLocalDate(query.departureDate) !== null &&
    (value as string) < (query.departureDate as string)
  ) {
    return 'returnDate must not be before departureDate';
  }
  return null;
}

function IsOptionalReturnDate(): PropertyDecorator {
  return ValidateBy({
    name: 'isOptionalReturnDate',
    validator: {
      validate: (value, args) => returnDateProblem(value, args!) === null,
      defaultMessage: (args) => returnDateProblem(args!.value, args!) ?? '',
    },
  });
}

/**
 * GET /api/itineraries/:id/flights (ITN-26). The flight search query (FLT-11, FLT-12,
 * FLT-15) without the destination, which is every airport of the itinerary's first city,
 * and with both dates optional: they default to the itinerary's first and last days.
 * Passengers, cabin, price range, sorting and paging are the same fields as search.
 */
export class ItineraryFlightSearchQueryDto extends OmitType(
  FlightSearchQueryDto,
  [
    'departureAirportId',
    'arrivalAirportId',
    'departureDate',
    'returnDate',
  ] as const,
) {
  @ApiProperty({
    example: 'CAI',
    description: 'IATA code of the airport you fly from (GET /api/airports).',
  })
  @Transform(trimUpper)
  @IsString()
  @Matches(IATA_CODE, {
    message: 'originAirportId must be a 3-letter IATA code (for example CAI)',
  })
  originAirportId: string;

  @ApiPropertyOptional({
    example: '2026-12-20',
    description:
      "Defaults to the itinerary's start date. On the calendar of the origin airport; not before today there.",
  })
  @IsOptional()
  @IsLocalDate()
  departureDate?: string;

  @ApiPropertyOptional({
    example: '2026-12-27',
    description:
      "Only for a ROUND_TRIP. Defaults to the date of the itinerary's last day. On the calendar of the airport the return flight leaves from; not before departureDate.",
  })
  @IsOptionalReturnDate()
  returnDate?: string;
}
