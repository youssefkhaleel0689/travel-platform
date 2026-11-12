import { Role, UserStatus } from '../common/auth/auth.enums';
import { AuthService } from './auth.service';
import type { RegisterDto } from './dto/register.dto';
import type {
  CreateUserInput,
  UserProfile,
  UsersService,
} from './users/users.service';

const PROFILE: UserProfile = {
  id: '6720f1c2a1b2c3d4e5f60718',
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  phone: null,
  preferredCurrency: null,
  role: Role.USER,
  status: UserStatus.ACTIVE,
  mustChangePassword: false,
  createdAt: new Date('2026-11-12T10:00:00.000Z'),
};

const dto: RegisterDto = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Travel2026',
  acceptTerms: true,
};

// Fake UsersService; the cast is done only here.
function setup() {
  const users = {
    create: jest.fn((_input: CreateUserInput) => Promise.resolve(PROFILE)),
  };
  const service = new AuthService(users as unknown as UsersService);
  return { service, users };
}

describe('AuthService.register (ACC-01)', () => {
  it('creates a USER with the plain password and a terms timestamp', async () => {
    const { service, users } = setup();
    const before = Date.now();
    await service.register(dto);

    const input = users.create.mock.calls[0][0];
    expect(input).toEqual({
      name: 'Sara Ahmed',
      email: 'sara@example.com',
      password: 'Travel2026',
      role: Role.USER,
      termsAcceptedAt: expect.any(Date),
    });
    expect(input.termsAcceptedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('always uses the USER role, even if a role sneaks into the object', async () => {
    const { service, users } = setup();
    const withRole = Object.assign({}, dto, { role: Role.ADMIN });
    await service.register(withRole);

    expect(users.create.mock.calls[0][0].role).toBe(Role.USER);
  });

  it('returns the created profile', async () => {
    const { service } = setup();
    await expect(service.register(dto)).resolves.toBe(PROFILE);
  });
});
