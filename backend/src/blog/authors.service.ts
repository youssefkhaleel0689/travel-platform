import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import { UserStatus } from '../common/auth/auth.enums';
import { PublicItinerariesService } from '../itineraries/public-itineraries.service';
import { OBJECT_ID } from './blog-access.service';
import { AuthorPageDto } from './dto/author-page.dto';
import { PostsService } from './posts.service';

// BLG-12: name, join date, published posts and public itineraries of one author.
@Injectable()
export class AuthorsService {
  constructor(
    private readonly users: UsersService,
    private readonly posts: PostsService,
    private readonly itineraries: PublicItinerariesService,
  ) {}

  async getAuthorPage(
    authorId: string,
    postsPage: number,
    itinerariesPage: number,
  ): Promise<AuthorPageDto> {
    const author = OBJECT_ID.test(authorId)
      ? (await this.users.findBriefsByIds([authorId])).get(authorId)
      : undefined;
    // A deactivated account has no public page (ACC-12).
    if (!author || author.status === UserStatus.DEACTIVATED) {
      throw new NotFoundException({
        code: 'AUTHOR_NOT_FOUND',
        message: 'Author not found',
      });
    }

    const [posts, itineraries] = await Promise.all([
      this.posts.listPublicByAuthor(new Types.ObjectId(authorId), postsPage),
      this.itineraries.listByAuthor(authorId, itinerariesPage),
    ]);

    const dto = new AuthorPageDto();
    dto.id = author.id;
    dto.name = author.name;
    dto.joinedAt = author.createdAt.toISOString();
    dto.posts = posts;
    dto.publicItineraries = itineraries;
    return dto;
  }
}
