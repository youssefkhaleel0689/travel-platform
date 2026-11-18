import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IATA_CODE } from '../../../common/reference-data/reference-data.patterns';
import { IsLocalDateTime } from '../../../common/time/local-date-time.validators';
import { trimText } from '../../../common/validation/text-transforms';
import { isSent, trimUpper } from '../../airlines/dto/create-airline.dto';

// Body of PATCH /flights/:id (FLT-05): any of the two airports and the two local times.
// Not accepted from the client, on purpose: airlineId, status, flightNumber, the UTC
// instants and departureDateKey (the server computes them), and the cabins (prices and seat
// counts are changed on PATCH /flights/:id/cabins/:cabinId). Written out instead of
// PartialType because PartialType adds @IsOptional(), which lets null through.
export class UpdateFlightDto {
  @ApiPropertyOptional({
    example: 'CAI',
    description:
      'IATA code of a seeded airport. Can only change while the flight has no booking and no seat hold. If you change it, send departureLocalInput too.',
  })
  @Transform(trimUpper)
  @ValidateIf(isSent)
  @IsString()
  @Matches(IATA_CODE, {
    message:
      'departureAirportId must be a 3-letter IATA code (for example CAI)',
  })
  departureAirportId?: string;

  @ApiPropertyOptional({
    example: 'DXB',
    description:
      'IATA code of a seeded airport. Can only change while the flight has no booking and no seat hold. If you change it, send arrivalLocalInput too.',
  })
  @Transform(trimUpper)
  @ValidateIf(isSent)
  @IsString()
  @Matches(IATA_CODE, {
    message: 'arrivalAirportId must be a 3-letter IATA code (for example DXB)',
  })
  arrivalAirportId?: string;

  @ApiPropertyOptional({
    example: '2026-12-20T09:15',
    description:
      'New departure time on the clock of the DEPARTURE airport: YYYY-MM-DDTHH:mm, no offset. Stored in UTC. Must be in the future. Passengers with a CONFIRMED booking are notified.',
  })
  @Transform(trimText)
  @ValidateIf(isSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  @IsLocalDateTime()
  departureLocalInput?: string;

  @ApiPropertyOptional({
    example: '2026-12-20T15:15',
    description:
      'New arrival time on the clock of the ARRIVAL airport: YYYY-MM-DDTHH:mm, no offset. Stored in UTC. Must be after the departure when both are compared in UTC. Passengers with a CONFIRMED booking are notified.',
  })
  @Transform(trimText)
  @ValidateIf(isSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  @IsLocalDateTime()
  arrivalLocalInput?: string;
}
