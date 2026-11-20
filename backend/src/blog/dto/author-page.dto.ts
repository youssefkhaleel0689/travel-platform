import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PageMetaDto } from '../../common/pagination/dto/page.dto';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { PublicItinerarySummaryDto } from '../../itineraries/dto/public-itinerary-response.dto';
import { PostSummaryDto } from './post-response.dto';
import { MAX_PAGE } from '../../common/pagination/pagination.constants';

export class AuthorPageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    default: 1,
    description: 'Page of the public itineraries (page is for the posts)',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  itinerariesPage: number = 1;
}

export class AuthorPostPageDto {
  @ApiProperty({ type: [PostSummaryDto] })
  items: PostSummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class AuthorItineraryPageDto {
  @ApiProperty({ type: [PublicItinerarySummaryDto] })
  items: PublicItinerarySummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class AuthorPageDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60701' })
  id: string;

  @ApiProperty({ example: 'Mona Adel' })
  name: string;

  @ApiProperty({ example: '2026-11-02T08:30:00.000Z' })
  joinedAt: string;

  @ApiProperty({
    type: AuthorPostPageDto,
    description: 'Published posts, newest first',
  })
  posts: AuthorPostPageDto;

  @ApiProperty({
    type: AuthorItineraryPageDto,
    description: 'Public itineraries (ITN-20), newest first',
  })
  publicItineraries: AuthorItineraryPageDto;
}
