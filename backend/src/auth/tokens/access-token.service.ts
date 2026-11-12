import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// A user id as stored in MongoDB: an ObjectId written as 24 hex characters.
const USER_ID = /^[0-9a-f]{24}$/i;

/** Signs and checks the access token (ACC-04, ACC-19). Settings: jwtModuleOptions(). */
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  /**
   * The payload is { sub } only. The role is not in the token: the guard loads it from the
   * database on every request, so a role change or suspension applies at once.
   */
  sign(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId });
  }

  /**
   * The user id of a valid token, or null for a token that is invalid, expired, tampered
   * with, signed with another algorithm or another secret, or whose sub is not a user id.
   * Never throws for a bad token: the caller treats null as "not logged in".
   */
  async verify(token: string): Promise<{ userId: string } | null> {
    let payload: object;
    try {
      payload = await this.jwt.verifyAsync<object>(token);
    } catch {
      return null;
    }
    const sub: unknown = 'sub' in payload ? payload.sub : undefined;
    return typeof sub === 'string' && USER_ID.test(sub)
      ? { userId: sub }
      : null;
  }
}
