import type { CookieOptions, Response } from 'express';
import { Role, UserStatus } from '../common/auth/auth.enums';
import { AuthService } from './auth.service';
import type { RegisterDto } from './dto/register.dto';
import type { AccessTokenService } from './tokens/access-token.service';
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

const TOKEN = 'signed.access.token';

const dto: RegisterDto = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Travel2026',
  acceptTerms: true,
};

// Fake UsersService, AccessTokenService and response; the casts are done only here.
function setup() {
  const users = {
    create: jest.fn((_input: CreateUserInput) => Promise.resolve(PROFILE)),
  };
  const accessTokens = {
    sign: jest.fn((_userId: string) => Promise.resolve(TOKEN)),
  };
  const res = {
    cookie: jest.fn(
      (_name: string, _value: string, _options: CookieOptions) => undefined,
    ),
  };
  const service = new AuthService(
    users as unknown as UsersService,
    accessTokens as unknown as AccessTokenService,
  );
  return {
    service,
    users,
    accessTokens,
    res,
    response: res as unknown as Response,
  };
}

describe('AuthService.register (ACC-01)', () => {
  it('creates a USER with the plain password and a terms timestamp', async () => {
    const { service, users, response } = setup();
    const before = Date.now();
    await service.register(dto, response);

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
    const { service, users, response } = setup();
    const withRole = Object.assign({}, dto, { role: Role.ADMIN });
    await service.register(withRole, response);

    expect(users.create.mock.calls[0][0].role).toBe(Role.USER);
  });

  it('logs the new user in: signs a token for its id and sets the cookie', async () => {
    const { service, accessTokens, res, response } = setup();
    await service.register(dto, response);

    expect(accessTokens.sign).toHaveBeenCalledWith(PROFILE.id);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      TOKEN,
      expect.objectContaining({ httpOnly: true, maxAge: 1_800_000 }),
    );
  });

  it('returns the created profile', async () => {
    const { service, response } = setup();
    await expect(service.register(dto, response)).resolves.toBe(PROFILE);
  });

  it('sets no cookie when the user cannot be created', async () => {
    const { service, users, accessTokens, res, response } = setup();
    users.create.mockRejectedValueOnce(new Error('duplicate'));

    await expect(service.register(dto, response)).rejects.toThrow('duplicate');
    expect(accessTokens.sign).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('AuthService.startSession (ACC-04, ACC-19)', () => {
  it('sets the signed token as the cookie and returns the profile', async () => {
    const { service, accessTokens, res, response } = setup();
    await expect(service.startSession(response, PROFILE)).resolves.toBe(
      PROFILE,
    );
    expect(accessTokens.sign).toHaveBeenCalledWith(PROFILE.id);
    expect(res.cookie.mock.calls[0][1]).toBe(TOKEN);
  });
});
