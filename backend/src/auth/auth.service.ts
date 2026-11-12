import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role, UserStatus } from '../common/auth/auth.enums';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { unauthenticated } from './guards/jwt-auth.guard';
import { AccessTokenService } from './tokens/access-token.service';
import { setAccessTokenCookie } from './tokens/auth-cookie';
import { UserProfile, UsersService } from './users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  /**
   * ACC-01: creates a USER account and logs it in. The role is never taken from the
   * request (ACC-01, ACC-18: no admin self-registration).
   */
  async register(dto: RegisterDto, res: Response): Promise<UserProfile> {
    const profile = await this.users.create({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      role: Role.USER,
      termsAcceptedAt: new Date(),
    });
    return this.startSession(res, profile);
  }

  /**
   * ACC-04: logs a user in with email and password and sets the access token cookie.
   *
   * The status is checked only after the password matches, so a wrong password never
   * reveals whether an account exists or is suspended: it is always 401 INVALID_CREDENTIALS.
   */
  async login(dto: LoginDto, res: Response): Promise<UserProfile> {
    const verified = await this.users.verifyCredentials(
      dto.email,
      dto.password,
    );
    if (!verified) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'invalid email or password',
      });
    }
    const { profile } = verified;
    if (profile.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'account suspended',
      });
    }
    if (profile.status === UserStatus.DEACTIVATED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'account deactivated',
      });
    }
    return this.startSession(res, profile);
  }

  /**
   * ACC-04, ACC-11, ACC-19: the logged-in user's profile, for GET /auth/me and /users/me.
   * The guard has just loaded the user, but it can be deleted between the guard and this
   * call; that is the same 401 as a missing session, never a 500.
   */
  async currentProfile(userId: string): Promise<UserProfile> {
    const profile = await this.users.findById(userId);
    if (!profile) {
      throw unauthenticated();
    }
    return profile;
  }

  /**
   * The only place that starts a session (ACC-04, ACC-19): signs the access token for the
   * user and sets it as the httpOnly cookie. Login (step F) and register use it.
   */
  async startSession(
    res: Response,
    profile: UserProfile,
  ): Promise<UserProfile> {
    const token = await this.accessTokens.sign(profile.id);
    setAccessTokenCookie(res, token);
    return profile;
  }
}
