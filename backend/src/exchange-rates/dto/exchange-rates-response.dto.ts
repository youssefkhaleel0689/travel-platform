import { ApiProperty } from '@nestjs/swagger';

export class ExchangeRatesResponseDto {
  @ApiProperty({ example: 'USD' })
  base: string;

  @ApiProperty({
    example: { USD: 1, EUR: 0.92, EGP: 48.5 },
    description: 'Units of each currency per 1 USD',
  })
  rates: Record<string, number>;

  @ApiProperty({ example: '2026-11-05', description: 'Date of these rates' })
  rateDate: string;

  @ApiProperty({
    example: false,
    description: 'true if FXRatesAPI was unreachable and older rates are shown',
  })
  stale: boolean;
}
