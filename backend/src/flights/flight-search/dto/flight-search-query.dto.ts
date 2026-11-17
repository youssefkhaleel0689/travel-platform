import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { IATA_CODE } from '../../../common/reference-data/reference-data.patterns';
import { IsLocalDate } from '../../../common/time/local-date-time.validators';
import { trimUpper } from '../../airlines/dto/create-airline.dto';
import { CabinCategory } from '../../schemas/flight.schema';
import {
  FlightSortBy,
  MAX_SEATED_PASSENGERS,
  MONEY_AMOUNT,
  SortOrder,
  TripType,
} from '../flight-search.constants';
import {
  IsAmountNotBelow,
  IsAtMostCount,
  IsDifferentFrom,
  IsSumWithin,
  IsValidReturnDate,
} from './flight-search-query.validators';

// Query of GET /flights/search (FLT-11, FLT-12, FLT-15). Rules that need the database or
// the airport's clock (seeded airports, a date in the past) are checked by the service.
export class FlightSearchQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: 'CAI',
    description: 'IATA code of a seeded airport (GET /api/airports).',
  })
  @Transform(trimUpper)
  @IsString()
  @Matches(IATA_CODE, {
    message:
      'departureAirportId must be a 3-letter IATA code (for example CAI)',
  })
  departureAirportId: string;

  @ApiProperty({
    example: 'DXB',
    description:
      'IATA code of a seeded airport. Must differ from departureAirportId.',
  })
  @Transform(trimUpper)
  @IsString()
  @Matches(IATA_CODE, {
    message: 'arrivalAirportId must be a 3-letter IATA code (for example DXB)',
  })
  @IsDifferentFrom('departureAirportId')
  arrivalAirportId: string;

  @ApiProperty({
    example: '2026-12-20',
    description:
      'Departure date on the calendar of the DEPARTURE airport (YYYY-MM-DD). Not before today there.',
  })
  @IsLocalDate()
  departureDate: string;

  @ApiPropertyOptional({ enum: TripType, default: TripType.ONE_WAY })
  @Transform(trimUpper)
  @IsOptional()
  @IsEnum(TripType)
  tripType: TripType = TripType.ONE_WAY;

  @ApiPropertyOptional({
    example: '2026-12-27',
    description:
      "Only for a ROUND_TRIP, and required there. Date on the calendar of the return flight's departure airport (the outbound arrival airport). Not before departureDate.",
  })
  @IsValidReturnDate()
  returnDate?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_SEATED_PASSENGERS,
    default: 1,
    description: 'Passengers aged 12 or more.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEATED_PASSENGERS)
  adults: number = 1;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    default: 0,
    description: `Passengers aged 2 to 11. adults + children is at most ${MAX_SEATED_PASSENGERS}.`,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @IsSumWithin('adults', MAX_SEATED_PASSENGERS)
  children: number = 0;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    default: 0,
    description:
      "Passengers under 2. They sit on an adult's lap, so there are at most as many infants as adults.",
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @IsAtMostCount('adults')
  infants: number = 0;

  @ApiPropertyOptional({
    enum: CabinCategory,
    description: 'Only flights with seats in this cabin.',
  })
  @Transform(trimUpper)
  @IsOptional()
  @IsEnum(CabinCategory)
  cabin?: CabinCategory;

  @ApiPropertyOptional({
    example: '100.00',
    description: 'Inclusive, per seat in USD.',
  })
  @IsOptional()
  @Matches(MONEY_AMOUNT, {
    message:
      'minPrice must be an amount with at most 2 decimals, for example 100.00',
  })
  minPrice?: string;

  @ApiPropertyOptional({
    example: '500.00',
    description: 'Inclusive, per seat in USD. Not below minPrice.',
  })
  @IsOptional()
  @Matches(MONEY_AMOUNT, {
    message:
      'maxPrice must be an amount with at most 2 decimals, for example 500.00',
  })
  @IsAmountNotBelow('minPrice')
  maxPrice?: string;

  @ApiPropertyOptional({ enum: FlightSortBy, default: FlightSortBy.PRICE })
  @IsOptional()
  @IsEnum(FlightSortBy)
  sortBy: FlightSortBy = FlightSortBy.PRICE;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.ASC })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.ASC;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    default: 1,
    description:
      'Page of the return flights (ROUND_TRIP). `page` is the page of the outbound flights.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  returnPage: number = 1;
}
