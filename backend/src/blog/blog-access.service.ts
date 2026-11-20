import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import { Role, UserStatus } from '../common/auth/auth.enums';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ModerationState } from '../common/moderation/moderation-state';
import type { LeanDoc } from '../common/pagination/paginate';
import { DELETED_USER_NAME, PostStatus } from './blog.constants';
import { AuthorBriefDto } from './dto/author-brief.dto';
import { Post } from './schemas/post.schema';

export type LeanPost = LeanDoc<Post>;

export const OBJECT_ID = /^[0-9a-f]{24}$/i;

export function postNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'POST_NOT_FOUND',
    message: 'Post not found',
  });
}

// Who may see a post. Public: PUBLISHED, VISIBLE and the author is not
// deactivated. Drafts and hidden posts: the author and admins. Deleted:
// admins only. Everyone else gets the same 404 as for a missing post.
@Injectable()
export class BlogAccessService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    private readonly users: UsersService,
  ) {}

  async publicPostFilter(): Promise<QueryFilter<Post>> {
    const deactivated = await this.users.findIdsByStatus(
      UserStatus.DEACTIVATED,
    );
    return {
      status: PostStatus.PUBLISHED,
      moderationState: ModerationState.VISIBLE,
      ...(deactivated.length > 0 && {
        authorId: {
          $nin: deactivated.map((id) => new Types.ObjectId(id)),
        },
      }),
    };
  }

  async findViewablePost(
    id: string,
    viewer: AuthenticatedUser | undefined,
  ): Promise<LeanPost> {
    if (!OBJECT_ID.test(id)) {
      throw postNotFound();
    }
    const post = await this.postModel.findById(id).lean<LeanPost>().exec();
    if (!post || !(await this.canView(post, viewer))) {
      throw postNotFound();
    }
    return post;
  }

  async findPublicPost(id: string): Promise<LeanPost> {
    if (!OBJECT_ID.test(id)) {
      throw postNotFound();
    }
    const post = await this.postModel
      .findOne({
        _id: new Types.ObjectId(id),
        status: PostStatus.PUBLISHED,
        moderationState: ModerationState.VISIBLE,
      })
      .lean<LeanPost>()
      .exec();
    if (!post || !(await this.isAuthorActive(post.authorId))) {
      throw postNotFound();
    }
    return post;
  }

  async isPublic(post: LeanPost): Promise<boolean> {
    return (
      post.status === PostStatus.PUBLISHED &&
      post.moderationState === ModerationState.VISIBLE &&
      (await this.isAuthorActive(post.authorId))
    );
  }

  async canView(
    post: LeanPost,
    viewer: AuthenticatedUser | undefined,
  ): Promise<boolean> {
    if (viewer?.role === Role.ADMIN) {
      return true;
    }
    if (post.moderationState === ModerationState.DELETED) {
      return false;
    }
    if (viewer && post.authorId.toString() === viewer.userId) {
      return true;
    }
    return this.isPublic(post);
  }

  async authorBriefs(
    ids: Types.ObjectId[],
  ): Promise<Map<string, AuthorBriefDto>> {
    const briefs = await this.users.findBriefsByIds(
      ids.map((id) => id.toString()),
    );
    const result = new Map<string, AuthorBriefDto>();
    for (const id of ids) {
      const key = id.toString();
      const brief = briefs.get(key);
      result.set(
        key,
        brief && brief.status !== UserStatus.DEACTIVATED
          ? { id: brief.id, name: brief.name }
          : { id: null, name: DELETED_USER_NAME },
      );
    }
    return result;
  }

  private async isAuthorActive(authorId: Types.ObjectId): Promise<boolean> {
    const brief = (await this.users.findBriefsByIds([authorId.toString()])).get(
      authorId.toString(),
    );
    return brief !== undefined && brief.status !== UserStatus.DEACTIVATED;
  }
}
