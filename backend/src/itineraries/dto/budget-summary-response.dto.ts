import { ApiProperty } from '@nestjs/swagger';

// Only used to document the budget summary in Swagger (ITN-14, ITN-18).
// Every amount is a decimal string with 2 decimals in `currency`.

export class BudgetByCategoryDto {
  @ApiProperty({ example: '100.00' })
  food: string;
  @ApiProperty({ example: '100.00' })
  accommodation: string;
  @ApiProperty({ example: '0.00' })
  local_transport: string;
  @ApiProperty({ example: '50.00', description: 'Includes activity costs' })
  activities: string;
  @ApiProperty({
    example: '100.00',
    description:
      'Intercity transport, kept separate from local transport (ITN-16)',
  })
  intercity_transport: string;
}

export class BudgetDayDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60719' })
  dayId: string;
  @ApiProperty({ example: 1 })
  dayNumber: number;
  @ApiProperty({ example: '2026-12-20' })
  date: string;
  @ApiProperty({ example: 'paris' })
  city: string;
  @ApiProperty({ example: '250.00' })
  total: string;
  @ApiProperty({ type: BudgetByCategoryDto })
  byCategory: BudgetByCategoryDto;
}

export class BudgetCityGroupDto {
  @ApiProperty({ example: 'paris' })
  city: string;
  @ApiProperty({ example: 1 })
  fromDay: number;
  @ApiProperty({ example: 2 })
  toDay: number;
  @ApiProperty({ example: 2 })
  dayCount: number;
  @ApiProperty({ example: '350.00' })
  total: string;
}

export class BudgetSummaryDto {
  @ApiProperty({
    example: 'USD',
    description: 'The display currency asked for',
  })
  currency: string;
  @ApiProperty({ example: '350.00' })
  total: string;
  @ApiProperty({ type: BudgetByCategoryDto })
  byCategory: BudgetByCategoryDto;
  @ApiProperty({ type: [BudgetDayDto] })
  byDay: BudgetDayDto[];
  @ApiProperty({ type: [BudgetCityGroupDto] })
  byCityGroup: BudgetCityGroupDto[];
  @ApiProperty({
    example: '2026-11-18',
    description: 'Date of the exchange rates used',
  })
  rateDate: string;
  @ApiProperty({
    example: false,
    description:
      'true when FXRatesAPI was unreachable and the last cached rates were used',
  })
  ratesStale: boolean;
}
