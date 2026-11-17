import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { IATA_CODE } from '../../../common/reference-data/reference-data.patterns';
import { IsLocalDateTime } from '../../../common/time/local-date-time.validators';
import { trimText } from '../../../common/validation/text-transforms';
import { trimUpper } from '../../airlines/dto/create-airline.dto';

// Airline code plus digits, for example MS777. Upper-cased before it is checked, so the
// duplicate check on airline + number + date cannot be dodged with "ms777" or "MS 777".
export const FLIGHT_NUMBER = /^[A-Z0-9]{2,10}$/;

// Body of POST /flights (FLT-03). Not accepted from the client, on purpose:
// - airlineId: it comes from the moderator's airlineModeratorAssignment, so a moderator
//   can never create a flight for another airline;
// - status, cabinInventory, the UTC instants and departureDateKey: the server sets or
//   computes them (cabins are added with FLT-04).
export class CreateFlightDto {
  @ApiProperty({
    example: 'MS777',
    description:
      '2 to 10 letters or digits (airline code plus number). Unique per airline and departure date.',
  })
  @Transform(trimUpper)
  @IsString()
  @Matches(FLIGHT_NUMBER, {
    message:
      'flightNumber must be 2 to 10 letters or digits (for example MS777)',
  })
  flightNumber: string;

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
  arrivalAirportId: string;

  @ApiProperty({
    example: '2026-12-20T08:30',
    description:
      'Departure time on the clock of the DEPARTURE airport: YYYY-MM-DDTHH:mm, no offset. Stored in UTC. Must be in the future.',
  })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  @IsLocalDateTime()
  departureLocalInput: string;

  @ApiProperty({
    example: '2026-12-20T14:30',
    description:
      'Arrival time on the clock of the ARRIVAL airport: YYYY-MM-DDTHH:mm, no offset. Stored in UTC. Must be after the departure when both are compared in UTC.',
  })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  @IsLocalDateTime()
  arrivalLocalInput: string;
}
