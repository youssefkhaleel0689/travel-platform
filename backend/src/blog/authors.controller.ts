import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/public.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { validationFailed } from '../common/swagger/standard-errors';
import { AuthorsService } from './authors.service';
import { AuthorPageDto, AuthorPageQueryDto } from './dto/author-page.dto';

const AUTHOR_ID = '6720f1c2a1b2c3d4e5f60701';
const PATH = `/api/authors/${AUTHOR_ID}`;

@ApiTags('Blog')
@Controller('authors')
export class AuthorsController {
  constructor(private readonly authors: AuthorsService) {}

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Public author page: name, join date, posts, itineraries (BLG-12)',
    description:
      'Public. page pages the posts, itinerariesPage the public itineraries ' +
      '(ITN-20). A deactivated account has no page.',
  })
  @ApiParam({ name: 'id', description: 'Account id of the author', example: AUTHOR_ID })
  @ApiOkResponse({ type: AuthorPageDto })
  @ApiErrorResponse(
    validationFailed(PATH, [
      { field: 'itinerariesPage', messages: ['itinerariesPage must not be less than 1'] },
    ]),
  )
  @ApiErrorResponse({
    status: 404,
    description: 'No such account, or it was deactivated',
    examples: [{ code: 'AUTHOR_NOT_FOUND', message: 'Author not found', path: PATH }],
  })
  getOne(
    @Param('id') id: string,
    @Query() query: AuthorPageQueryDto,
  ): Promise<AuthorPageDto> {
    return this.authors.getAuthorPage(id, query.page, query.itinerariesPage);
  }
}
