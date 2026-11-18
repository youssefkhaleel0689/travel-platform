import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import {
  applyModeration,
  ContentModerationPort,
  ModeratedContent,
  ModerationResult,
} from '../common/moderation/content-moderation.port';
import { ModerationState } from '../common/moderation/moderation-state';
import type { LeanDoc } from '../common/pagination/paginate';
import { BlogAccessService, LeanPost, OBJECT_ID } from './blog-access.service';
import { counterChange } from './comments.service';
import { Comment } from './schemas/comment.schema';
import { Post } from './schemas/post.schema';

/** GEN-09, GEN-10 for posts: the blog's side of POST_MODERATION_PORT. */
@Injectable()
export class PostModerationAdapter implements ContentModerationPort {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    private readonly access: BlogAccessService,
  ) {}

  async findForModeration(id: string): Promise<ModeratedContent | null> {
    if (!OBJECT_ID.test(id)) {
      return null;
    }
    const post = await this.postModel.findById(id).lean<LeanPost>().exec();
    if (!post) {
      return null;
    }
    return {
      id,
      ownerId: post.authorId.toString(),
      moderationState: post.moderationState,
      reportable: await this.access.isPublic(post),
      preview: post.title,
    };
  }

  // A hidden or deleted post drops out of every public list, search and the
  // author page by itself, because those all filter on moderationState.
  moderate(
    id: string,
    to: ModerationState,
    actorId: string,
  ): Promise<ModerationResult | null> {
    return applyModeration(this.postModel, id, to, actorId);
  }
}

/**
 * GEN-09, GEN-10 for comments. commentCount counts visible comments, so
 * hiding or deleting a visible comment takes it off the post's count, and
 * restoring puts it back, in the same transaction as the state change.
 */
@Injectable()
export class CommentModerationAdapter implements ContentModerationPort {
  constructor(
    @InjectModel(Comment.name) private readonly commentModel: Model<Comment>,
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectConnection() private readonly connection: Connection,
    private readonly access: BlogAccessService,
  ) {}

  async findForModeration(id: string): Promise<ModeratedContent | null> {
    if (!OBJECT_ID.test(id)) {
      return null;
    }
    const comment = await this.commentModel
      .findById(id)
      .lean<LeanDoc<Comment>>()
      .exec();
    if (!comment) {
      return null;
    }
    const post = await this.postModel
      .findById(comment.postId)
      .lean<LeanPost>()
      .exec();
    return {
      id,
      ownerId: comment.authorId.toString(),
      moderationState: comment.moderationState,
      reportable:
        comment.moderationState === ModerationState.VISIBLE &&
        post !== null &&
        (await this.access.isPublic(post)),
      preview: comment.body.slice(0, 120),
    };
  }

  async moderate(
    id: string,
    to: ModerationState,
    actorId: string,
  ): Promise<ModerationResult | null> {
    return this.connection.transaction(async (session: ClientSession) => {
      const result = await applyModeration(
        this.commentModel,
        id,
        to,
        actorId,
        session,
      );
      if (!result?.changed) {
        return result;
      }
      const wasCounted = result.before === ModerationState.VISIBLE;
      const isCounted = result.after === ModerationState.VISIBLE;
      if (wasCounted !== isCounted) {
        const comment = await this.commentModel
          .findById(id)
          .select('postId')
          .session(session)
          .lean<{ postId: Comment['postId'] }>()
          .exec();
        await this.postModel
          .updateOne(
            { _id: comment!.postId },
            counterChange('commentCount', isCounted ? 1 : -1),
            { session },
          )
          .exec();
      }
      return result;
    });
  }
}
