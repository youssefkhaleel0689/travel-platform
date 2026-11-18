import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../reference/reference-data';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class BudgetSummaryQueryDto {
  @ApiProperty({
    example: 'EGP',
    description: `Display currency. One of: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  @Transform(upper)
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}

export class PublicDetailQueryDto {
  @ApiPropertyOptional({
    example: 'EGP',
    description: 'If given, the response also includes a budget summary',
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;
}
