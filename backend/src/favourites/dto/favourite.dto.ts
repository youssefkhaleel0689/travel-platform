import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { FavouriteType } from '../schemas/favourite.schema';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';

export class FavouriteDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ enum: FavouriteType, example: FavouriteType.HOTEL })
  type: FavouriteType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60719' })
  targetId: string;

  @ApiProperty({ example: 'Cairo Nile View Hotel' })
  label: string;

  @ApiPropertyOptional({ example: '2026-11-20T10:00:00.000Z' })
  createdAt?: string;
}

export class FavouritesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FavouriteType,
    description: 'Only hotels or only itineraries',
  })
  @IsOptional()
  @IsEnum(FavouriteType)
  type?: FavouriteType;
}
