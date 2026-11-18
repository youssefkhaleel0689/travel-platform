import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  COMMENT_MODERATION_PORT,
  POST_MODERATION_PORT,
} from '../common/moderation/content-moderation.port';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { MediaModule } from '../media/media.module';
import { AuthorsController } from './authors.controller';
import { AuthorsService } from './authors.service';
import { BlogAccessService } from './blog-access.service';
import {
  CommentModerationAdapter,
  PostModerationAdapter,
} from './blog-moderation.adapters';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { Post, PostSchema } from './schemas/post.schema';
import { TagsController } from './tags.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
    ]),
    AuthModule,
    MediaModule,
    ItinerariesModule,
  ],
  controllers: [
    PostsController,
    CommentsController,
    TagsController,
    AuthorsController,
  ],
  providers: [
    BlogAccessService,
    PostsService,
    CommentsService,
    AuthorsService,
    { provide: POST_MODERATION_PORT, useClass: PostModerationAdapter },
    { provide: COMMENT_MODERATION_PORT, useClass: CommentModerationAdapter },
  ],
  exports: [POST_MODERATION_PORT, COMMENT_MODERATION_PORT],
})
export class BlogModule {}
