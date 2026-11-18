import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNumber, Min } from 'class-validator';
import { BudgetCategory } from '../schemas/itinerary.schema';
import { SUPPORTED_CURRENCIES } from '../reference/reference-data';

export class CreateBudgetEntryDto {
  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.FOOD })
  @IsEnum(BudgetCategory)
  category: BudgetCategory;

  @ApiProperty({ example: 40, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'EUR' })
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}

export class UpdateBudgetEntryDto extends PartialType(CreateBudgetEntryDto) {}
