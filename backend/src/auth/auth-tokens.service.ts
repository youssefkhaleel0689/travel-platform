import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { ACCESS_TOKEN_MINUTES } from './auth.constants';
import { Role } from './enums/role.enum';

// What a verified access token carries. Nothing here is trusted on its own:
// the guard reloads the session and the user on every request, so a suspended
// account cannot keep working until its token expires.
export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  /** Session id, so logout and a password change can revoke this token. */
  sid: string;
  role: Role;
}

@Injectable()
export class AuthTokensService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      expiresIn: `${ACCESS_TOKEN_MINUTES}m`,
    });
  }

  /** Throws if the token is invalid or expired. */
  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token);
  }

  /**
   * A refresh token is 32 random bytes, not a JWT: it carries no claims and is
   * only ever compared against the hash stored on the session, so revoking it
   * server-side is a single update (ACC-06).
   */
  generateRefreshToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * SHA-256 is enough here, unlike for passwords: the token is 256 bits of
   * randomness, so there is nothing to brute-force or guess from a leak.
   */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
