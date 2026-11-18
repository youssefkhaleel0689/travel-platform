import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { PageMetaDto } from '../../common/pagination/dto/page.dto';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { PostSummaryDto } from './post-response.dto';

export class AuthorPageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    default: 1,
    description: 'Page of the public itineraries (page applies to the posts)',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  itinerariesPage: number = 1;
}

export class AuthorPostPageDto {
  @ApiProperty({ type: [PostSummaryDto] })
  items: PostSummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class PublicItinerarySummaryDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60770' })
  id: string;

  @ApiProperty({ example: 'Cairo and Luxor in a week' })
  title: string;
}

export class PublicItineraryPageDto {
  @ApiProperty({
    type: [PublicItinerarySummaryDto],
    description: 'The itinerary module may add fields such as the destination',
  })
  items: PublicItinerarySummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

/** BLG-12: the public author page. */
export class AuthorPageDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60701' })
  id: string;

  @ApiProperty({ example: 'Mona Adel' })
  name: string;

  @ApiProperty({ example: '2026-11-02T08:30:00.000Z', description: 'Registration date' })
  joinedAt: string;

  @ApiProperty({
    type: AuthorPostPageDto,
    description: 'Published, visible posts, newest first, 10 per page',
  })
  posts: AuthorPostPageDto;

  @ApiProperty({
    type: PublicItineraryPageDto,
    nullable: true,
    description:
      'Public itineraries (ITN-20), 10 per page; null while the itineraries ' +
      'module is not connected (see itinerariesAvailable)',
  })
  publicItineraries: PublicItineraryPageDto | null;

  @ApiProperty({ example: true })
  itinerariesAvailable: boolean;
}
