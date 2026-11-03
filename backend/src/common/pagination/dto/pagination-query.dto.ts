import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

// Query params for paginated list endpoints. There is no limit param on purpose.
export class PaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    example: 1,
    description: 'Page number, starting at 1. Page size is fixed at 10.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;
}
