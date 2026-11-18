import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import { UserStatus } from '../common/auth/auth.enums';
import { PUBLIC_ITINERARIES_PORT } from '../common/itineraries/public-itineraries.port';
// Type only: a type in a decorated constructor signature has to be imported
// this way while isolatedModules and emitDecoratorMetadata are both on.
import type { PublicItinerariesPort } from '../common/itineraries/public-itineraries.port';
import { OBJECT_ID } from './blog-access.service';
import { AuthorPageDto } from './dto/author-page.dto';
import { PostsService } from './posts.service';

function authorNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AUTHOR_NOT_FOUND',
    message: 'Author not found',
  });
}

/**
 * BLG-12: name, join date, published posts and public itineraries of one
 * author. The itineraries come from D1 through PUBLIC_ITINERARIES_PORT; while
 * that module is not connected the page still works, with
 * itinerariesAvailable: false.
 */
@Injectable()
export class AuthorsService {
  constructor(
    private readonly users: UsersService,
    private readonly posts: PostsService,
    @Optional()
    @Inject(PUBLIC_ITINERARIES_PORT)
    private readonly itineraries?: PublicItinerariesPort,
  ) {}

  async getAuthorPage(
    authorId: string,
    postsPage: number,
    itinerariesPage: number,
  ): Promise<AuthorPageDto> {
    if (!OBJECT_ID.test(authorId)) {
      throw authorNotFound();
    }
    const author = (await this.users.findBriefsByIds([authorId])).get(authorId);
    // ACC-12: a deactivated account has no public page.
    if (!author || author.status === UserStatus.DEACTIVATED) {
      throw authorNotFound();
    }

    const [posts, itineraries] = await Promise.all([
      this.posts.listPublicByAuthor(new Types.ObjectId(authorId), postsPage),
      this.itineraries
        ? this.itineraries.listPublicByAuthor(authorId, itinerariesPage)
        : Promise.resolve(null),
    ]);

    const dto = new AuthorPageDto();
    dto.id = author.id;
    dto.name = author.name;
    dto.joinedAt = author.createdAt.toISOString();
    dto.posts = posts;
    dto.publicItineraries = itineraries;
    dto.itinerariesAvailable = this.itineraries !== undefined;
    return dto;
  }
}
