import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationState } from '../../common/moderation/moderation-state';
import { PageMetaDto } from '../../common/pagination/dto/page.dto';
import { PostStatus } from '../blog.constants';
import { AuthorBriefDto } from './author-brief.dto';
import { CommentDto } from './comment.dto';

export class PostImageDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60760' })
  id: string;

  @ApiProperty({
    example:
      '/api/posts/6720f1c2a1b2c3d4e5f60718/images/6720f1c2a1b2c3d4e5f60760',
    description: 'Fetch the image from this URL (GEN-08)',
  })
  url: string;

  @ApiProperty({ example: 'image/jpeg', enum: ['image/jpeg', 'image/png'] })
  mimeType: string;

  @ApiProperty({ example: 284113 })
  sizeBytes: number;
}

/** One row of the public list, search, tag page and author page (BLG-02, BLG-09). */
export class PostSummaryDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Three days in Luxor' })
  title: string;

  @ApiProperty({
    example: 'We started at Karnak at sunrise, before the tour buses...',
    description: 'The first 200 characters of the body',
  })
  excerpt: string;

  @ApiProperty({ type: AuthorBriefDto })
  author: AuthorBriefDto;

  @ApiProperty({ type: [String], example: ['egypt', 'history'] })
  tags: string[];

  @ApiProperty({ example: 4 })
  likeCount: number;

  @ApiProperty({ example: 2 })
  commentCount: number;

  @ApiProperty({ example: 6, description: 'likeCount + commentCount' })
  interactionScore: number;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  publishedAt: string;
}

/** BLG-03: one of your own posts, drafts and hidden ones included. */
export class MyPostDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Three days in Luxor' })
  title: string;

  @ApiProperty({ enum: PostStatus, example: PostStatus.DRAFT })
  status: PostStatus;

  @ApiProperty({
    enum: ModerationState,
    example: ModerationState.VISIBLE,
    description: 'HIDDEN when an admin hid it: only you and admins see it',
  })
  moderationState: ModerationState;

  @ApiProperty({ example: 4 })
  likeCount: number;

  @ApiProperty({ example: 2 })
  commentCount: number;

  @ApiProperty({ example: '2026-11-18T09:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    example: '2026-11-18T10:00:00.000Z',
    nullable: true,
    description: 'null while the post has never been published',
  })
  publishedAt: string | null;

  @ApiProperty({ example: '2026-11-18T10:05:00.000Z' })
  updatedAt: string;
}

export class CommentPageDto {
  @ApiProperty({ type: [CommentDto] })
  items: CommentDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

/** BLG-02: the post page. */
export class PostDetailDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Three days in Luxor' })
  title: string;

  @ApiProperty({ example: 'We started at Karnak at sunrise, before the tour buses...' })
  body: string;

  @ApiProperty({ enum: PostStatus, example: PostStatus.PUBLISHED })
  status: PostStatus;

  @ApiProperty({ enum: ModerationState, example: ModerationState.VISIBLE })
  moderationState: ModerationState;

  @ApiProperty({ type: AuthorBriefDto })
  author: AuthorBriefDto;

  @ApiProperty({ type: [String], example: ['egypt', 'history'] })
  tags: string[];

  @ApiProperty({ type: [PostImageDto] })
  images: PostImageDto[];

  @ApiProperty({ example: 4 })
  likeCount: number;

  @ApiProperty({ example: 2 })
  commentCount: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether you liked it; absent for a guest',
  })
  likedByMe?: boolean;

  @ApiProperty({ example: true, description: 'Whether you wrote it' })
  isAuthor: boolean;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z', nullable: true })
  publishedAt: string | null;

  @ApiProperty({ example: '2026-11-18T09:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-18T10:05:00.000Z' })
  updatedAt: string;

  @ApiProperty({
    type: CommentPageDto,
    description:
      'The first page of comments, oldest first. Further pages: ' +
      'GET /api/posts/{id}/comments?page=2',
  })
  comments: CommentPageDto;
}

/** BLG-06: the like state after a like or unlike. */
export class LikeStatusDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  postId: string;

  @ApiProperty({ example: true })
  liked: boolean;

  @ApiProperty({ example: 5 })
  likeCount: number;
}
