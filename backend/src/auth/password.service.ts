import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import {
  BCRYPT_ROUNDS,
  PASSWORD_PATTERN,
  PASSWORD_MIN_LENGTH,
} from './auth.constants';

// GEN-13: passwords exist in the database only as salted bcrypt hashes.
// bcrypt generates and embeds its own random salt, so no salt column is needed.
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, BCRYPT_ROUNDS);
  }

  verify(plain: string, passwordHash: string): Promise<boolean> {
    return compare(plain, passwordHash);
  }

  /**
   * ACC-01, ACC-08: at least 8 characters with at least one letter and one
   * digit. The DTOs check this too; this method exists so services that build
   * a password themselves (ACC-07a, ACC-13) cannot produce an invalid one.
   */
  satisfiesPolicy(plain: string): boolean {
    return plain.length >= PASSWORD_MIN_LENGTH && PASSWORD_PATTERN.test(plain);
  }

  /**
   * ACC-07a: a temporary password for an admin-initiated reset. It always
   * satisfies the policy, and it is returned to the admin once and never
   * stored in plain text.
   */
  generateTemporaryPassword(): string {
    // 9 hex characters always contain a digit in practice, but the suffix makes
    // the letter and digit requirement certain rather than likely.
    return `Tmp${randomBytes(5).toString('hex')}9`;
  }
}
