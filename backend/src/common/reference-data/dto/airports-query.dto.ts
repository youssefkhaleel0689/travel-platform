import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../pagination/dto/pagination-query.dto';
import { COUNTRY_CODE, SLUG_ID } from '../reference-data.patterns';

export class AirportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'cairo' })
  @IsOptional()
  @Matches(SLUG_ID)
  cityId?: string;

  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @Matches(COUNTRY_CODE)
  countryId?: string;
}
