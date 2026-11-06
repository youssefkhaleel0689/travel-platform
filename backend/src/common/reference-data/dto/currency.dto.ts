import { ApiProperty } from '@nestjs/swagger';

export class CurrencyDto {
  @ApiProperty({ example: 'USD', description: 'Currency code' })
  id: string;
}
