import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';
import { CURRENCY_CODE } from '../../common/reference-data/reference-data.patterns';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class BudgetSummaryQueryDto {
  @ApiProperty({
    example: 'EGP',
    description:
      'Display currency: one of the seeded currencies (GET /api/currencies); others give 400 UNSUPPORTED_CURRENCY',
  })
  @Transform(upper)
  @Matches(CURRENCY_CODE, {
    message: 'currency must be a 3-letter currency code',
  })
  currency: string;
}

export class PublicDetailQueryDto {
  @ApiPropertyOptional({
    example: 'EGP',
    description: 'If given, the response also includes a budget summary',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(CURRENCY_CODE, {
    message: 'currency must be a 3-letter currency code',
  })
  currency?: string;
}
