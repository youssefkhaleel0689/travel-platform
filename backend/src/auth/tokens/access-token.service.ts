import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// A user or session id as stored in MongoDB: an ObjectId written as 24 hex characters.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

/** Signs and checks the access token (ACC-04, ACC-06, ACC-19). Settings: jwtModuleOptions(). */
@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  /**
   * The payload is { sub, sid } only: the user id and the session id (ACC-06). The role is
   * not in the token: the guard loads it from the database on every request, so a role
   * change or suspension applies at once. The guard also checks the session on every
   * request, so a revoked or idle session ends the token at once.
   */
  sign(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, sid: sessionId });
  }

  /**
   * The user and session ids of a valid token, or null for a token that is invalid,
   * expired, tampered with, signed with another algorithm or another secret, or whose sub
   * or sid is not an id (a token from before ACC-06, without sid, is rejected too).
   * Never throws for a bad token: the caller treats null as "not logged in".
   */
  async verify(
    token: string,
  ): Promise<{ userId: string; sessionId: string } | null> {
    let payload: object;
    try {
      payload = await this.jwt.verifyAsync<object>(token);
    } catch {
      return null;
    }
    const sub: unknown = 'sub' in payload ? payload.sub : undefined;
    const sid: unknown = 'sid' in payload ? payload.sid : undefined;
    return isObjectId(sub) && isObjectId(sid)
      ? { userId: sub, sessionId: sid }
      : null;
  }
}
