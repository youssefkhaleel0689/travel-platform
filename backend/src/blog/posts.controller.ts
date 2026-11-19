import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import {
  CurrentUser,
  OptionalUser,
} from '../common/auth/current-user.decorator';
import { Public } from '../common/auth/public.decorator';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';
import {
  ApiErrorResponse,
  type ApiErrorResponseOptions,
} from '../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
  validationFailed,
} from '../common/swagger/standard-errors';
import { ApiImageUpload } from '../media/api-image-upload.decorator';
import { IMAGE_MIME_TYPES } from '../media/media.constants';
import type { UploadedImage } from '../media/media.service';
import { CommentDto } from './dto/comment.dto';
import {
  CreatePostDto,
  PostsQueryDto,
  UpdatePostDto,
} from './dto/post-request.dto';
import {
  LikeStatusDto,
  MyPostDto,
  PostDetailDto,
  PostImageDto,
  PostSummaryDto,
} from './dto/post-response.dto';
import { PostsService } from './posts.service';

const POST_ID = '6720f1c2a1b2c3d4e5f60718';
const IMAGE_ID = '6720f1c2a1b2c3d4e5f60760';
const POSTS = '/api/posts';
const POST = `${POSTS}/${POST_ID}`;
const LIKE = `${POST}/like`;
const IMAGES = `${POST}/images`;
const IMAGE = `${IMAGES}/${IMAGE_ID}`;

const POST_ID_PARAM = { name: 'id', description: 'Post id', example: POST_ID };
const IMAGE_ID_PARAM = {
  name: 'imageId',
  description: 'Image id',
  example: IMAGE_ID,
};

function postNotFound(path: string, description: string): ApiErrorResponseOptions {
  return {
    status: 404,
    description,
    examples: [{ code: 'POST_NOT_FOUND', message: 'Post not found', path }],
  };
}

const VIEW_RULE =
  'Drafts and posts an admin hid are visible only to their author and to ' +
  'admins; anyone else gets the same 404 as for a post that does not exist.';

@ApiTags('Blog')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Write a post, as a draft or published (BLG-01, BLG-08)',
    description:
      'Title and body are required; up to 5 tags. Add images afterwards with ' +
      'POST /api/posts/{id}/images (BLG-10).',
  })
  @ApiCreatedResponse({ type: PostDetailDto })
  @ApiErrorResponse(
    validationFailed(POSTS, [
      { field: 'title', messages: ['title should not be empty'] },
      { field: 'tags', messages: ['tags must contain no more than 5 elements'] },
    ]),
  )
  @ApiErrorResponse(unauthenticated(POSTS))
  @ApiErrorResponse(forbidden(POSTS, { role: false, passwordChange: true }))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePostDto,
  ): Promise<PostDetailDto> {
    return this.posts.create(user, dto);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Browse and search published posts (BLG-02, BLG-09)',
    description:
      'Public. Without keyword: newest first. With keyword: matches the ' +
      'title, a tag or the author name, ordered by interaction score ' +
      '(likes + comments), newest first on a tie. tag narrows to one tag. ' +
      'An empty items array with totalItems 0 means "no results".',
  })
  @ApiPaginatedResponse(PostSummaryDto)
  @ApiErrorResponse(
    validationFailed(POSTS, [
      { field: 'keyword', messages: ['keyword should not be empty'] },
    ]),
  )
  list(@Query() query: PostsQueryDto): Promise<PageDto<PostSummaryDto>> {
    return this.posts.listPublic(query);
  }

  @Get('mine')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'List your own posts, drafts included (BLG-03)',
    description:
      'Newest first, 10 per page, with status, date, like count and comment ' +
      'count. Posts an admin hid are included and marked HIDDEN.',
  })
  @ApiPaginatedResponse(MyPostDto)
  @ApiErrorResponse(validationFailed(`${POSTS}/mine`, [
    { field: 'page', messages: ['page must not be less than 1'] },
  ]))
  @ApiErrorResponse(unauthenticated(`${POSTS}/mine`))
  @ApiErrorResponse(forbidden(`${POSTS}/mine`, { role: false, passwordChange: true }))
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PageDto<MyPostDto>> {
    return this.posts.listMine(user, query.page);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Open a post (BLG-02)',
    description:
      'Title, author, date, body, tags, images, like count and the first ' +
      `page of comments. ${VIEW_RULE}`,
  })
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ type: PostDetailDto })
  @ApiErrorResponse(postNotFound(POST, 'No such post, or you may not see it'))
  getOne(
    @Param('id') id: string,
    @OptionalUser() viewer: AuthenticatedUser | undefined,
  ): Promise<PostDetailDto> {
    return this.posts.getPost(id, viewer);
  }

  @Patch(':id')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Edit your post, its tags or its status (BLG-04, BLG-08)',
    description:
      'Send only the fields that change. tags replaces the whole list. ' +
      'Publishing a draft sets its publication date.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ type: PostDetailDto })
  @ApiErrorResponse({
    status: 400,
    description: 'An invalid field, or an empty body',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: POST,
        errors: [{ field: 'title', messages: ['title should not be empty'] }],
      },
      {
        code: 'NOTHING_TO_UPDATE',
        message: 'Send at least one of title, body, tags or status',
        path: POST,
      },
    ],
  })
  @ApiErrorResponse(unauthenticated(POST))
  @ApiErrorResponse(forbidden(POST, { role: false, passwordChange: true }))
  @ApiErrorResponse(postNotFound(POST, 'No such post, or it is not yours'))
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePostDto,
  ): Promise<PostDetailDto> {
    return this.posts.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Delete your post (BLG-04)',
    description:
      'Permanent: the post, its comments, likes and images are removed.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiNoContentResponse({ description: 'The post is gone' })
  @ApiErrorResponse(unauthenticated(POST))
  @ApiErrorResponse(forbidden(POST, { role: false, passwordChange: true }))
  @ApiErrorResponse(postNotFound(POST, 'No such post, or it is not yours'))
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.posts.remove(id, user);
  }

  @Get(':id/comments')
  @Public()
  @ApiOperation({
    summary: 'Read the comments of a post, oldest first (BLG-02, BLG-05)',
    description: `10 per page. ${VIEW_RULE}`,
  })
  @ApiParam(POST_ID_PARAM)
  @ApiPaginatedResponse(CommentDto)
  @ApiErrorResponse(validationFailed(`${POST}/comments`, [
    { field: 'page', messages: ['page must not be less than 1'] },
  ]))
  @ApiErrorResponse(postNotFound(`${POST}/comments`, 'No such post, or you may not see it'))
  listComments(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @OptionalUser() viewer: AuthenticatedUser | undefined,
  ): Promise<PageDto<CommentDto>> {
    return this.posts.listComments(id, viewer, query.page);
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Like a published post (BLG-06)',
    description:
      'A user likes a post at most once; liking again changes nothing and ' +
      'returns the same answer.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ type: LikeStatusDto })
  @ApiErrorResponse(unauthenticated(LIKE))
  @ApiErrorResponse(forbidden(LIKE, { role: false, passwordChange: true }))
  @ApiErrorResponse(postNotFound(LIKE, 'No such published post'))
  like(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LikeStatusDto> {
    return this.posts.like(id, user);
  }

  @Delete(':id/like')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Remove your like (BLG-06)' })
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ type: LikeStatusDto })
  @ApiErrorResponse(unauthenticated(LIKE))
  @ApiErrorResponse(forbidden(LIKE, { role: false, passwordChange: true }))
  @ApiErrorResponse(postNotFound(LIKE, 'No such post, or you may not see it'))
  unlike(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LikeStatusDto> {
    return this.posts.unlike(id, user);
  }

  @Post(':id/images')
  @ApiCookieAuth()
  @ApiImageUpload(IMAGES, 'post')
  @ApiOperation({
    summary: 'Attach an image to your post (BLG-10, GEN-08)',
    description:
      'Multipart, field "file": one JPG or PNG of at most 5 MB. A post holds ' +
      'at most 5 images. The response has the URL that serves it.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiCreatedResponse({ type: PostImageDto })
  @ApiErrorResponse(unauthenticated(IMAGES))
  @ApiErrorResponse(forbidden(IMAGES, { role: false, passwordChange: true }))
  @ApiErrorResponse(postNotFound(IMAGES, 'No such post, or it is not yours'))
  addImage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<PostImageDto> {
    return this.posts.addImage(id, user, file);
  }

  @Get(':id/images/:imageId')
  @Public()
  @ApiOperation({
    summary: 'Download an image of a post (BLG-10, GEN-08)',
    description: `Served to whoever may see the post. ${VIEW_RULE}`,
  })
  @ApiParam(POST_ID_PARAM)
  @ApiParam(IMAGE_ID_PARAM)
  @ApiProduces(...IMAGE_MIME_TYPES)
  @ApiOkResponse({
    description: 'The image file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such post or image, or you may not see the post',
    examples: [
      { code: 'POST_NOT_FOUND', message: 'Post not found', path: IMAGE },
      { code: 'IMAGE_NOT_FOUND', message: 'Image not found', path: IMAGE },
    ],
  })
  async getImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @OptionalUser() viewer: AuthenticatedUser | undefined,
  ): Promise<StreamableFile> {
    const image = await this.posts.openImage(id, imageId, viewer);
    return new StreamableFile(createReadStream(image.path), {
      type: image.mimeType,
      length: image.sizeBytes,
    });
  }

  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Remove an image from your post (BLG-10)' })
  @ApiParam(POST_ID_PARAM)
  @ApiParam(IMAGE_ID_PARAM)
  @ApiNoContentResponse({ description: 'The image is gone' })
  @ApiErrorResponse(unauthenticated(IMAGE))
  @ApiErrorResponse(forbidden(IMAGE, { role: false, passwordChange: true }))
  @ApiErrorResponse({
    status: 404,
    description: 'No such post or image, or the post is not yours',
    examples: [
      { code: 'POST_NOT_FOUND', message: 'Post not found', path: IMAGE },
      { code: 'IMAGE_NOT_FOUND', message: 'Image not found', path: IMAGE },
    ],
  })
  async removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.posts.removeImage(id, imageId, user);
  }
}
