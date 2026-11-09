import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  AIRLINE_ICAO_CODE,
  AIRLINE_IATA_CODE,
} from '../../schemas/airline.schema';

// Trims text and upper-cases codes before validation; other types are left for the validators.
export const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// Body of POST /airlines (FLT-01). The logo is not accepted here: it is uploaded
// through the image-upload endpoint (GEN-08), added in a later PR.
export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir', maxLength: 100 })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'MS',
    description: 'IATA airline code: 2 letters or digits. Unique.',
  })
  @Transform(trimUpper)
  @IsString()
  @Matches(AIRLINE_IATA_CODE, {
    message: 'iataCode must be 2 letters or digits (for example MS)',
  })
  iataCode: string;

  @ApiPropertyOptional({
    example: 'MSR',
    description: 'ICAO airline code: 3 letters. Unique when present.',
  })
  @Transform(trimUpper)
  @IsOptional()
  @IsString()
  @Matches(AIRLINE_ICAO_CODE, {
    message: 'icaoCode must be 3 letters (for example MSR)',
  })
  icaoCode?: string;
}
