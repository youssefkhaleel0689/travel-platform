import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../pagination/dto/pagination-query.dto';
import { COUNTRY_CODE } from '../reference-data.patterns';

export class CitiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @Matches(COUNTRY_CODE)
  countryId?: string;
}
