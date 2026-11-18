import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, QueryFilter, Types } from 'mongoose';
import { Role } from '../common/auth/auth.enums';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ownerFilter } from '../common/auth/ownership';
import { ModerationState } from '../common/moderation/moderation-state';
import { PageDto } from '../common/pagination/dto/page.dto';
import { LeanDoc, paginateQuery } from '../common/pagination/paginate';
import { BlogAccessService, OBJECT_ID } from './blog-access.service';
import { CommentDto } from './dto/comment.dto';
import { Comment } from './schemas/comment.schema';
import { Post } from './schemas/post.schema';

type LeanComment = LeanDoc<Comment>;

function commentNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'COMMENT_NOT_FOUND',
    message: 'Comment not found',
  });
}

/** The change to likeCount/commentCount and the score that sums them. */
export function counterChange(field: 'likeCount' | 'commentCount', by: 1 | -1) {
  return { $inc: { [field]: by, interactionScore: by } };
}

/**
 * BLG-05 and BLG-07: comments on public posts, edited and deleted by their
 * author only (ACC-11). Each change that adds or removes a visible comment
 * moves the post's commentCount and interactionScore in the same transaction,
 * so the BLG-09 ranking is never out of step with what readers see.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name) private readonly commentModel: Model<Comment>,
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectConnection() private readonly connection: Connection,
    private readonly access: BlogAccessService,
  ) {}

  /** BLG-05: only on a post everyone can see. */
  async create(
    postId: string,
    user: AuthenticatedUser,
    body: string,
  ): Promise<CommentDto> {
    const post = await this.access.findPublicPost(postId);
    const comment = await this.connection.transaction(
      async (session: ClientSession) => {
        const [created] = await this.commentModel.create(
          [{ postId: post._id, authorId: new Types.ObjectId(user.userId), body }],
          { session },
        );
        await this.postModel
          .updateOne({ _id: post._id }, counterChange('commentCount', 1), {
            session,
          })
          .exec();
        return created;
      },
    );
    return (await this.toDtos([comment.toObject() as LeanComment]))[0];
  }

  /** BLG-07: the author edits the text. 404 for anyone else's comment. */
  async update(
    commentId: string,
    user: AuthenticatedUser,
    body: string,
  ): Promise<CommentDto> {
    if (!OBJECT_ID.test(commentId)) {
      throw commentNotFound();
    }
    const updated = await this.commentModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(commentId),
          ...ownerFilter(user, 'authorId'),
          moderationState: { $ne: ModerationState.DELETED },
        },
        { $set: { body, editedAt: new Date() } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<LeanComment>()
      .exec();
    if (!updated) {
      throw commentNotFound();
    }
    return (await this.toDtos([updated]))[0];
  }

  /**
   * BLG-07: the author removes the comment for good. A visible comment also
   * leaves the post's count; a hidden one had already stopped counting.
   */
  async remove(commentId: string, user: AuthenticatedUser): Promise<void> {
    if (!OBJECT_ID.test(commentId)) {
      throw commentNotFound();
    }
    await this.connection.transaction(async (session: ClientSession) => {
      const removed = await this.commentModel
        .findOneAndDelete(
          {
            _id: new Types.ObjectId(commentId),
            ...ownerFilter(user, 'authorId'),
            moderationState: { $ne: ModerationState.DELETED },
          },
          { session },
        )
        .lean<LeanComment>()
        .exec();
      if (!removed) {
        throw commentNotFound();
      }
      if (removed.moderationState === ModerationState.VISIBLE) {
        await this.postModel
          .updateOne(
            { _id: removed.postId },
            counterChange('commentCount', -1),
            { session },
          )
          .exec();
      }
    });
  }

  /**
   * BLG-02, BLG-05: one page of a post's comments, oldest first. Hidden
   * comments are included only for their author and for admins (GEN-10).
   * The caller has already checked that the viewer may see the post.
   */
  async listForPost(
    postId: Types.ObjectId,
    viewer: AuthenticatedUser | undefined,
    page: number,
  ): Promise<PageDto<CommentDto>> {
    const filter: QueryFilter<Comment> = { postId };
    if (viewer?.role === Role.ADMIN) {
      filter.moderationState = { $ne: ModerationState.DELETED };
    } else if (viewer) {
      filter.$or = [
        { moderationState: ModerationState.VISIBLE },
        {
          moderationState: ModerationState.HIDDEN,
          authorId: new Types.ObjectId(viewer.userId),
        },
      ];
    } else {
      filter.moderationState = ModerationState.VISIBLE;
    }
    const result = await paginateQuery(this.commentModel, filter, {
      page,
      sort: { createdAt: 1, _id: 1 },
    });
    return new PageDto(await this.toDtos(result.items), result.meta);
  }

  /** Removes every comment of a post (the author deleted the post, BLG-04). */
  async removeAllForPost(
    postId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.commentModel.deleteMany({ postId }, { session }).exec();
  }

  private async toDtos(comments: LeanComment[]): Promise<CommentDto[]> {
    const authors = await this.access.authorBriefs(
      comments.map((comment) => comment.authorId),
    );
    return comments.map((comment) => {
      const dto = new CommentDto();
      dto.id = comment._id.toString();
      dto.postId = comment.postId.toString();
      dto.author = authors.get(comment.authorId.toString())!;
      dto.body = comment.body;
      dto.edited = comment.editedAt != null;
      if (comment.moderationState !== ModerationState.VISIBLE) {
        dto.moderationState = comment.moderationState;
      }
      dto.createdAt = comment.createdAt.toISOString();
      dto.updatedAt = comment.updatedAt.toISOString();
      return dto;
    });
  }
}
