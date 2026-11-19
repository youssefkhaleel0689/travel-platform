import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, QueryFilter, Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { findOwnedOrThrow, ownerFilter } from '../common/auth/ownership';
import { ModerationState } from '../common/moderation/moderation-state';
import { PageDto } from '../common/pagination/dto/page.dto';
import { paginateQuery } from '../common/pagination/paginate';
import { escapeRegExp } from '../common/validation/escape-regexp';
import { MediaTargetType } from '../media/media.constants';
import {
  ImageFile,
  MediaService,
  StoredImage,
  UploadedImage,
} from '../media/media.service';
import {
  BlogAccessService,
  LeanPost,
  postNotFound,
} from './blog-access.service';
import { EXCERPT_LENGTH, PostStatus } from './blog.constants';
import { CommentsService, counterChange } from './comments.service';
import { CommentDto } from './dto/comment.dto';
import { CreatePostDto, PostsQueryDto, UpdatePostDto } from './dto/post-request.dto';
import {
  LikeStatusDto,
  MyPostDto,
  PostDetailDto,
  PostImageDto,
  PostSummaryDto,
} from './dto/post-response.dto';
import { Like } from './schemas/like.schema';
import { Post } from './schemas/post.schema';

const DUPLICATE_KEY = 11000;

const OWNED_POST = {
  notFoundCode: 'POST_NOT_FOUND',
  notFoundMessage: 'Post not found',
  ownerField: 'authorId',
} as const;

export function excerptOf(body: string): string {
  if (body.length <= EXCERPT_LENGTH) {
    return body;
  }
  const cut = body.slice(0, EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > EXCERPT_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(Like.name) private readonly likeModel: Model<Like>,
    @InjectConnection() private readonly connection: Connection,
    private readonly access: BlogAccessService,
    private readonly comments: CommentsService,
    private readonly media: MediaService,
    private readonly users: UsersService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreatePostDto): Promise<PostDetailDto> {
    const post = await this.postModel.create({
      authorId: new Types.ObjectId(user.userId),
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      status: dto.status,
      publishedAt: dto.status === PostStatus.PUBLISHED ? new Date() : null,
    });
    return this.getPost(post._id.toString(), user);
  }

  async update(
    id: string,
    user: AuthenticatedUser,
    dto: UpdatePostDto,
  ): Promise<PostDetailDto> {
    const changes: Partial<Post> = {};
    if (dto.title !== undefined) changes.title = dto.title;
    if (dto.body !== undefined) changes.body = dto.body;
    if (dto.tags !== undefined) changes.tags = dto.tags;
    if (dto.status !== undefined) changes.status = dto.status;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        code: 'NOTHING_TO_UPDATE',
        message: 'Send at least one of title, body, tags or status',
      });
    }

    const post = await this.findOwnedPost(id, user);
    if (changes.status === PostStatus.PUBLISHED && !post.publishedAt) {
      changes.publishedAt = new Date();
    }
    const result = await this.postModel
      .updateOne(
        {
          _id: post._id,
          ...ownerFilter(user, 'authorId'),
          moderationState: { $ne: ModerationState.DELETED },
        },
        { $set: changes },
        { runValidators: true },
      )
      .exec();
    if (result.matchedCount === 0) {
      throw postNotFound();
    }
    return this.getPost(id, user);
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const post = await this.findOwnedPost(id, user);
    await this.connection.transaction(async (session: ClientSession) => {
      const result = await this.postModel
        .deleteOne(
          {
            _id: post._id,
            ...ownerFilter(user, 'authorId'),
            moderationState: { $ne: ModerationState.DELETED },
          },
          { session },
        )
        .exec();
      if (result.deletedCount === 0) {
        throw postNotFound();
      }
      await this.comments.removeAllForPost(post._id, session);
      await this.likeModel.deleteMany({ postId: post._id }, { session }).exec();
    });
    await this.media.removeAllForTarget(MediaTargetType.POST, id);
  }

  async listPublic(query: PostsQueryDto): Promise<PageDto<PostSummaryDto>> {
    const filter: QueryFilter<Post> = await this.access.publicPostFilter();
    if (query.tag) {
      filter.tags = query.tag;
    }
    if (query.keyword) {
      const term = new RegExp(escapeRegExp(query.keyword), 'i');
      const authorIds = await this.users.findIdsByNameFragment(query.keyword);
      filter.$or = [
        { title: term },
        { tags: term },
        ...(authorIds.length > 0
          ? [{ authorId: { $in: authorIds.map((a) => new Types.ObjectId(a)) } }]
          : []),
      ];
    }
    const sort: Record<string, 1 | -1> = query.keyword
      ? { interactionScore: -1, publishedAt: -1, _id: -1 }
      : { publishedAt: -1, _id: -1 };
    return this.summaries(filter, query.page, sort);
  }

  listByTag(tag: string, page: number): Promise<PageDto<PostSummaryDto>> {
    return this.listPublic({ tag, page });
  }

  async listPublicByAuthor(
    authorId: Types.ObjectId,
    page: number,
  ): Promise<PageDto<PostSummaryDto>> {
    const filter: QueryFilter<Post> = {
      ...(await this.access.publicPostFilter()),
    };
    filter.authorId = authorId;
    return this.summaries(filter, page, { publishedAt: -1, _id: -1 });
  }

  async listMine(
    user: AuthenticatedUser,
    page: number,
  ): Promise<PageDto<MyPostDto>> {
    const result = await paginateQuery(
      this.postModel,
      {
        ...ownerFilter(user, 'authorId'),
        moderationState: { $ne: ModerationState.DELETED },
      },
      { page, sort: { createdAt: -1, _id: -1 } },
    );
    return new PageDto(
      result.items.map((post) => {
        const dto = new MyPostDto();
        dto.id = post._id.toString();
        dto.title = post.title;
        dto.status = post.status;
        dto.moderationState = post.moderationState;
        dto.likeCount = post.likeCount;
        dto.commentCount = post.commentCount;
        dto.createdAt = post.createdAt.toISOString();
        dto.publishedAt = post.publishedAt?.toISOString() ?? null;
        dto.updatedAt = post.updatedAt.toISOString();
        return dto;
      }),
      result.meta,
    );
  }

  async getPost(
    id: string,
    viewer: AuthenticatedUser | undefined,
  ): Promise<PostDetailDto> {
    const post = await this.access.findViewablePost(id, viewer);
    const [authors, images, comments, liked] = await Promise.all([
      this.access.authorBriefs([post.authorId]),
      this.media.listForTarget(MediaTargetType.POST, id),
      this.comments.listForPost(post._id, viewer, 1),
      viewer
        ? this.likeModel
            .exists({ postId: post._id, userId: new Types.ObjectId(viewer.userId) })
            .exec()
        : Promise.resolve(null),
    ]);

    const dto = new PostDetailDto();
    dto.id = post._id.toString();
    dto.title = post.title;
    dto.body = post.body;
    dto.status = post.status;
    dto.moderationState = post.moderationState;
    dto.author = authors.get(post.authorId.toString())!;
    dto.tags = post.tags;
    dto.images = images.map(toImageDto);
    dto.likeCount = post.likeCount;
    dto.commentCount = post.commentCount;
    if (viewer) {
      dto.likedByMe = liked !== null;
    }
    dto.isAuthor = viewer?.userId === post.authorId.toString();
    dto.publishedAt = post.publishedAt?.toISOString() ?? null;
    dto.createdAt = post.createdAt.toISOString();
    dto.updatedAt = post.updatedAt.toISOString();
    dto.comments = comments;
    return dto;
  }

  async listComments(
    id: string,
    viewer: AuthenticatedUser | undefined,
    page: number,
  ): Promise<PageDto<CommentDto>> {
    const post = await this.access.findViewablePost(id, viewer);
    return this.comments.listForPost(post._id, viewer, page);
  }

  async addImage(
    id: string,
    user: AuthenticatedUser,
    file: UploadedImage | undefined,
  ): Promise<PostImageDto> {
    await this.findOwnedPost(id, user);
    const image = await this.media.storeImage({
      ownerId: user.userId,
      targetType: MediaTargetType.POST,
      targetId: id,
      file,
      urlFor: (imageId) => `/api/posts/${id}/images/${imageId}`,
    });
    return toImageDto(image);
  }

  async removeImage(
    id: string,
    imageId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.findOwnedPost(id, user);
    await this.media.removeFromTarget(MediaTargetType.POST, id, imageId);
  }

  async openImage(
    id: string,
    imageId: string,
    viewer: AuthenticatedUser | undefined,
  ): Promise<ImageFile> {
    await this.access.findViewablePost(id, viewer);
    return this.media.openForTarget(MediaTargetType.POST, id, imageId);
  }

  async like(id: string, user: AuthenticatedUser): Promise<LikeStatusDto> {
    const post = await this.access.findPublicPost(id);
    try {
      await this.connection.transaction(async (session: ClientSession) => {
        await this.likeModel.create(
          [{ postId: post._id, userId: new Types.ObjectId(user.userId) }],
          { session },
        );
        await this.postModel
          .updateOne({ _id: post._id }, counterChange('likeCount', 1), { session })
          .exec();
      });
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) {
        throw error;
      }
    }
    return this.likeStatus(post._id, true);
  }

  async unlike(id: string, user: AuthenticatedUser): Promise<LikeStatusDto> {
    const post = await this.access.findViewablePost(id, user);
    await this.connection.transaction(async (session: ClientSession) => {
      const result = await this.likeModel
        .deleteOne(
          { postId: post._id, userId: new Types.ObjectId(user.userId) },
          { session },
        )
        .exec();
      if (result.deletedCount === 1) {
        await this.postModel
          .updateOne({ _id: post._id }, counterChange('likeCount', -1), {
            session,
          })
          .exec();
      }
    });
    return this.likeStatus(post._id, false);
  }

  private async findOwnedPost(
    id: string,
    user: AuthenticatedUser,
  ): Promise<LeanPost> {
    const post = await findOwnedOrThrow(this.postModel, id, user, OWNED_POST);
    if ((post as LeanPost).moderationState === ModerationState.DELETED) {
      throw postNotFound();
    }
    return post as LeanPost;
  }

  private async likeStatus(
    postId: Types.ObjectId,
    liked: boolean,
  ): Promise<LikeStatusDto> {
    const post = await this.postModel
      .findById(postId)
      .select('likeCount')
      .lean<{ likeCount: number }>()
      .exec();
    const dto = new LikeStatusDto();
    dto.postId = postId.toString();
    dto.liked = liked;
    dto.likeCount = post?.likeCount ?? 0;
    return dto;
  }

  private async summaries(
    filter: QueryFilter<Post>,
    page: number,
    sort: Record<string, 1 | -1>,
  ): Promise<PageDto<PostSummaryDto>> {
    const result = await paginateQuery(this.postModel, filter, { page, sort });
    const authors = await this.access.authorBriefs(
      result.items.map((post) => post.authorId),
    );
    return new PageDto(
      result.items.map((post) => {
        const dto = new PostSummaryDto();
        dto.id = post._id.toString();
        dto.title = post.title;
        dto.excerpt = excerptOf(post.body);
        dto.author = authors.get(post.authorId.toString())!;
        dto.tags = post.tags;
        dto.likeCount = post.likeCount;
        dto.commentCount = post.commentCount;
        dto.interactionScore = post.interactionScore;
        dto.publishedAt = (post.publishedAt ?? post.createdAt).toISOString();
        return dto;
      }),
      result.meta,
    );
  }
}

function toImageDto(image: StoredImage): PostImageDto {
  const dto = new PostImageDto();
  dto.id = image.id;
  dto.url = image.url;
  dto.mimeType = image.mimeType;
  dto.sizeBytes = image.sizeBytes;
  return dto;
}

