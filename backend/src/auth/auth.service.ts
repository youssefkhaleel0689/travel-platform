import { Injectable } from '@nestjs/common';
import { Role } from '../common/auth/auth.enums';
import { RegisterDto } from './dto/register.dto';
import { UserProfile, UsersService } from './users/users.service';

@Injectable()
export class AuthService {
  constructor(private readonly users: UsersService) {}

  /**
   * ACC-01: creates a USER account. The role is never taken from the request
   * (ACC-01, ACC-18: no admin self-registration).
   * PR 2 (ACC-04, ACC-19) will also set the login cookies here.
   */
  async register(dto: RegisterDto): Promise<UserProfile> {
    return this.users.create({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      role: Role.USER,
      termsAcceptedAt: new Date(),
    });
  }
}
