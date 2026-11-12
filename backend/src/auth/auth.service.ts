import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '../common/auth/auth.enums';
import { RegisterDto } from './dto/register.dto';
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
