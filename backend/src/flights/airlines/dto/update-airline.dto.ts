import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  AIRLINE_ICAO_CODE,
  AIRLINE_IATA_CODE,
} from '../../schemas/airline.schema';
import { isSent, trimText, trimUpper } from './create-airline.dto';

// Body of PATCH /airlines/:id (FLT-01): any of name, iataCode, icaoCode.
// status is not here: only the admin deactivate endpoint changes it (ACC-15).
// Written out instead of PartialType(CreateAirlineDto) because PartialType adds
// @IsOptional(), which lets null through to the update.
export class UpdateAirlineDto {
  @ApiPropertyOptional({ example: 'EgyptAir', maxLength: 100 })
  @Transform(trimText)
  @ValidateIf(isSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'MS',
    description: 'IATA airline code: 2 letters or digits. Unique.',
  })
  @Transform(trimUpper)
  @ValidateIf(isSent)
  @IsString()
  @Matches(AIRLINE_IATA_CODE, {
    message: 'iataCode must be 2 letters or digits (for example MS)',
  })
  iataCode?: string;

  @ApiPropertyOptional({
    example: 'MSR',
    description: 'ICAO airline code: 3 letters. Unique when present.',
  })
  @Transform(trimUpper)
  @ValidateIf(isSent)
  @IsString()
  @Matches(AIRLINE_ICAO_CODE, {
    message: 'icaoCode must be 3 letters (for example MSR)',
  })
  icaoCode?: string;
}
