import { Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import { Role, UserStatus } from '../common/auth/auth.enums';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ModerationState } from '../common/moderation/moderation-state';
import { BlogAccessService, LeanPost } from './blog-access.service';
import { PostStatus } from './blog.constants';

const AUTHOR = '6720f1c2a1b2c3d4e5f60701';
const OTHER = '6720f1c2a1b2c3d4e5f60702';
const ADMIN = '6720f1c2a1b2c3d4e5f60703';

function viewer(userId: string, role = Role.USER): AuthenticatedUser {
  return { userId, role, sessionId: '6720f1c2a1b2c3d4e5f60799' };
}

function post(overrides: Partial<LeanPost> = {}): LeanPost {
  return {
    _id: new Types.ObjectId(),
    authorId: new Types.ObjectId(AUTHOR),
    status: PostStatus.PUBLISHED,
    moderationState: ModerationState.VISIBLE,
    ...overrides,
  } as LeanPost;
}

describe('BlogAccessService.canView (BLG-02, GEN-10, ACC-12)', () => {
  let authorStatus: UserStatus;
  let service: BlogAccessService;

  beforeEach(() => {
    authorStatus = UserStatus.ACTIVE;
    const users = {
      findBriefsByIds: jest.fn(async () =>
        new Map([[AUTHOR, { id: AUTHOR, name: 'Mona', role: Role.USER, status: authorStatus, createdAt: new Date() }]]),
      ),
      findIdsByStatus: jest.fn(async () => []),
    } as unknown as UsersService;
    service = new BlogAccessService({} as never, users);
  });

  it('shows a published, visible post to everyone, guests included', async () => {
    expect(await service.canView(post(), undefined)).toBe(true);
    expect(await service.canView(post(), viewer(OTHER))).toBe(true);
  });

  it('shows a draft only to its author and admins', async () => {
    const draft = post({ status: PostStatus.DRAFT });
    expect(await service.canView(draft, undefined)).toBe(false);
    expect(await service.canView(draft, viewer(OTHER))).toBe(false);
    expect(await service.canView(draft, viewer(AUTHOR))).toBe(true);
    expect(await service.canView(draft, viewer(ADMIN, Role.ADMIN))).toBe(true);
  });

  it('shows hidden content only to its author and admins (GEN-10)', async () => {
    const hidden = post({ moderationState: ModerationState.HIDDEN });
    expect(await service.canView(hidden, viewer(OTHER))).toBe(false);
    expect(await service.canView(hidden, viewer(AUTHOR))).toBe(true);
    expect(await service.canView(hidden, viewer(ADMIN, Role.ADMIN))).toBe(true);
  });

  it('shows deleted content to admins only', async () => {
    const deleted = post({ moderationState: ModerationState.DELETED });
    expect(await service.canView(deleted, viewer(AUTHOR))).toBe(false);
    expect(await service.canView(deleted, viewer(ADMIN, Role.ADMIN))).toBe(true);
  });

  it('hides every post of a deactivated author from the public (ACC-12)', async () => {
    authorStatus = UserStatus.DEACTIVATED;
    expect(await service.canView(post(), viewer(OTHER))).toBe(false);
  });

  it('names a deactivated author "Deleted user" without an id', async () => {
    authorStatus = UserStatus.DEACTIVATED;
    const briefs = await service.authorBriefs([new Types.ObjectId(AUTHOR)]);
    expect(briefs.get(AUTHOR)).toEqual({ id: null, name: 'Deleted user' });
  });
});
