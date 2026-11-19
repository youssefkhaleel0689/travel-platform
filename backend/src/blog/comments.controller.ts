import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import {
  ApiErrorResponse,
  type ApiErrorResponseOptions,
} from '../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
  validationFailed,
} from '../common/swagger/standard-errors';
import { CommentsService } from './comments.service';
import { CommentBodyDto, CommentDto } from './dto/comment.dto';

const POST_ID = '6720f1c2a1b2c3d4e5f60718';
const COMMENT_ID = '6720f1c2a1b2c3d4e5f60750';
const POST_COMMENTS = `/api/posts/${POST_ID}/comments`;
const COMMENT = `/api/comments/${COMMENT_ID}`;

const BODY_ERRORS = [
  { field: 'body', messages: ['body must be shorter than or equal to 500 characters'] },
];

const COMMENT_NOT_FOUND: ApiErrorResponseOptions = {
  status: 404,
  description: 'No such comment, or it is not yours (ACC-11)',
  examples: [
    {
      code: 'COMMENT_NOT_FOUND',
      message: 'Comment not found',
      path: COMMENT,
    },
  ],
};

@ApiTags('Blog')
@ApiCookieAuth()
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post('posts/:id/comments')
  @ApiOperation({
    summary: 'Comment on a published post (BLG-05)',
    description: 'Non-empty, at most 500 characters.',
  })
  @ApiParam({ name: 'id', description: 'Post id', example: POST_ID })
  @ApiCreatedResponse({ type: CommentDto })
  @ApiErrorResponse(validationFailed(POST_COMMENTS, BODY_ERRORS))
  @ApiErrorResponse(unauthenticated(POST_COMMENTS))
  @ApiErrorResponse(forbidden(POST_COMMENTS, { role: false, passwordChange: true }))
  @ApiErrorResponse({
    status: 404,
    description: 'No such published post',
    examples: [{ code: 'POST_NOT_FOUND', message: 'Post not found', path: POST_COMMENTS }],
  })
  create(
    @Param('id') postId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.create(postId, user, dto.body);
  }

  @Patch('comments/:id')
  @ApiOperation({ summary: 'Edit your comment (BLG-07)' })
  @ApiParam({ name: 'id', description: 'Comment id', example: COMMENT_ID })
  @ApiOkResponse({ type: CommentDto })
  @ApiErrorResponse(validationFailed(COMMENT, BODY_ERRORS))
  @ApiErrorResponse(unauthenticated(COMMENT))
  @ApiErrorResponse(forbidden(COMMENT, { role: false, passwordChange: true }))
  @ApiErrorResponse(COMMENT_NOT_FOUND)
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.update(id, user, dto.body);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete your comment (BLG-07)' })
  @ApiParam({ name: 'id', description: 'Comment id', example: COMMENT_ID })
  @ApiNoContentResponse({ description: 'The comment is gone' })
  @ApiErrorResponse(unauthenticated(COMMENT))
  @ApiErrorResponse(forbidden(COMMENT, { role: false, passwordChange: true }))
  @ApiErrorResponse(COMMENT_NOT_FOUND)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.comments.remove(id, user);
  }
}
