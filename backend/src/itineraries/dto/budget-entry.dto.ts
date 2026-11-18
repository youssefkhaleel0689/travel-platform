import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, Matches, Max, Min } from 'class-validator';
import { BudgetCategory } from '../schemas/itinerary.schema';
import { CURRENCY_CODE } from '../../common/reference-data/reference-data.patterns';
import { MAX_ITINERARY_AMOUNT } from './money-limits';

export class CreateBudgetEntryDto {
  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.FOOD })
  @IsEnum(BudgetCategory)
  category: BudgetCategory;

  @ApiProperty({
    example: 40,
    minimum: 0,
    description:
      'Amount in `currency`, at most 2 decimals. Stored as Decimal128 and returned as a string.',
  })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_ITINERARY_AMOUNT)
  amount: number;

  @ApiProperty({
    example: 'EUR',
    description:
      'A seeded currency (GET /api/currencies); others give 400 UNSUPPORTED_CURRENCY',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(CURRENCY_CODE, {
    message: 'currency must be a 3-letter currency code',
  })
  currency: string;
}

export class UpdateBudgetEntryDto extends PartialType(CreateBudgetEntryDto) {}
