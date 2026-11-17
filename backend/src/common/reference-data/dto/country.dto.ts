import { ApiProperty } from '@nestjs/swagger';

export class CountryDto {
  @ApiProperty({ example: 'EG', description: 'Country code' })
  id: string;

  @ApiProperty({ example: 'Egypt' })
  name: string;

  @ApiProperty({ example: 'EGP', description: 'Currency code' })
  currency: string;
}
