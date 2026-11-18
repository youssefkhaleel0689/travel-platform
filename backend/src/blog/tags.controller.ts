import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/public.decorator';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { validationFailed } from '../common/swagger/standard-errors';
import { PostSummaryDto } from './dto/post-response.dto';
import { PostsService } from './posts.service';
import { normalizeTag } from './tags';

/** BLG-08: a clickable tag lists the published posts that carry it. */
@ApiTags('Blog')
@Controller('tags')
export class TagsController {
  constructor(private readonly posts: PostsService) {}

  @Get(':tag/posts')
  @Public()
  @ApiOperation({
    summary: 'List the published posts with a tag (BLG-08)',
    description:
      'Public, newest first, 10 per page. The tag is matched in its stored ' +
      'form, so "Egypt" and "egypt" are the same tag.',
  })
  @ApiParam({ name: 'tag', example: 'egypt' })
  @ApiPaginatedResponse(PostSummaryDto)
  @ApiErrorResponse(
    validationFailed('/api/tags/egypt/posts', [
      { field: 'page', messages: ['page must not be less than 1'] },
    ]),
  )
  list(
    @Param('tag') tag: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PageDto<PostSummaryDto>> {
    return this.posts.listByTag(normalizeTag(tag), query.page);
  }
}
