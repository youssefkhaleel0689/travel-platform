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

// A route id is 24 hex characters; anything else is a 404 without a query
// (same rule as findOwnedOrThrow, ACC-11).
export const OBJECT_ID = /^[0-9a-f]{24}$/i;

export function postNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'POST_NOT_FOUND',
    message: 'Post not found',
  });
}

/**
 * Who may see a post, in one place, so the post page, its images, its
 * comments, likes and the author page can never disagree:
 *
 * | Post                                   | Guest / other user | Author | Admin |
 * | -------------------------------------- | ------------------ | ------ | ----- |
 * | PUBLISHED, VISIBLE, author active      | yes                | yes    | yes   |
 * | DRAFT                                  | no                 | yes    | yes   |
 * | HIDDEN by an admin (GEN-10)            | no                 | yes    | yes   |
 * | DELETED by an admin (GEN-10)           | no                 | no     | yes   |
 * | author deactivated the account (ACC-12)| no                 | -      | yes   |
 *
 * "No" is always the same 404 POST_NOT_FOUND, so nobody can tell a draft or a
 * hidden post from one that does not exist.
 */
@Injectable()
export class BlogAccessService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    private readonly users: UsersService,
  ) {}

  /**
   * The filter every public list starts from (BLG-02, BLG-08, BLG-09,
   * BLG-12): published, visible, and not written by a deactivated account.
   * The author condition is part of the query so pages stay full and the
   * total stays right.
   */
  async publicPostFilter(): Promise<QueryFilter<Post>> {
    const deactivated = await this.users.findIdsByStatus(UserStatus.DEACTIVATED);
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

  /** The post if this viewer may see it (table above), otherwise 404. */
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

  /**
   * The post only if it is public: liking, commenting and reporting need a
   * post everyone can see. A draft or hidden post answers 404 even to its
   * author, because nobody else could see the like or the comment.
   */
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

  /** Whether everyone can see this post. */
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

  /**
   * Author names for many ids in one query. An account its owner deactivated
   * reads as "Deleted user" with no id (ACC-12): the status decides, nothing
   * is copied onto the content.
   */
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
