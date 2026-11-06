import { ApiProperty } from '@nestjs/swagger';

export class AirportDto {
  @ApiProperty({ example: 'CAI', description: 'IATA code' })
  id: string;

  @ApiProperty({ example: 'Cairo International Airport' })
  name: string;

  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryId: string;

  @ApiProperty({ example: 'Africa/Cairo', description: 'IANA time zone' })
  timeZone: string;
}
