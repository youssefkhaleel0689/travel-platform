import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_PAGE } from '../pagination.constants';

// Query params for paginated list endpoints. There is no limit param on purpose.
export class PaginationQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE,
    default: 1,
    example: 1,
    description: 'Page number, starting at 1. Page size is fixed at 10.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;
}
