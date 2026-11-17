import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import {
  PASSWORD_MAX_BYTES,
  passwordRuleViolation,
} from '../../common/validation/password';

export const DEFAULT_BCRYPT_COST = 12;
const MIN_BCRYPT_COST = 4;
const MAX_BCRYPT_COST = 15;

// The only place in the codebase that calls bcrypt.
@Injectable()
export class PasswordService {
  private readonly bcryptCost: number;

  constructor(config: ConfigService) {
    this.bcryptCost = parseBcryptCost(config.get<string>('BCRYPT_COST'));
  }

  get cost(): number {
    return this.bcryptCost;
  }

  async hash(plain: string): Promise<string> {
    // bcrypt would silently drop the extra bytes, so refuse instead of truncating.
    if (Buffer.byteLength(plain, 'utf8') > PASSWORD_MAX_BYTES) {
      throw new Error(
        `Password is longer than ${PASSWORD_MAX_BYTES} bytes and cannot be hashed`,
      );
    }
    return bcrypt.hash(plain, this.bcryptCost);
  }

  async verify(plain: string, passwordHash: string): Promise<boolean> {
    // bcrypt.compare truncates at 72 bytes, so a 72-byte password followed by extra
    // characters would otherwise match. No stored hash can come from a longer password.
    if (Buffer.byteLength(plain, 'utf8') > PASSWORD_MAX_BYTES) {
      return false;
    }
    return bcrypt.compare(plain, passwordHash);
  }

  /**
   * ACC-07a, ACC-13: a temporary password for an admin-initiated reset or a new
   * moderator account. It always satisfies the shared password rules, and it is
   * shown to the admin once and never stored in readable form.
   */
  generateTemporary(): string {
    // The Tmp prefix and the trailing digit make the letter and digit rules
    // certain rather than merely likely for a random hex string.
    const generated = `Tmp${randomBytes(5).toString('hex')}9`;
    if (passwordRuleViolation(generated) !== null) {
      // Unreachable, but a silent bad password would be worse than a crash.
      throw new Error('Generated temporary password breaks the password rules');
    }
    return generated;
  }

  /**
   * For a login with an unknown email (ACC-04): runs the same bcrypt comparison as a known
   * email, against a hash nobody knows the password of, and always resolves false. An
   * unknown email then takes as long as a known one, so the response time does not reveal
   * which emails are registered.
   */
  async verifyDummy(plain: string): Promise<false> {
    await this.verify(plain, await this.dummyHash());
    return false;
  }

  // Made once with the configured cost, on first use, so it costs the same as a real hash.
  // The promise is cached, so concurrent first calls share one hash.
  private dummyHashPromise: Promise<string> | null = null;

  private dummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = this.hash(randomBytes(16).toString('hex')).catch(
        (error: unknown) => {
          // Do not cache a failure: the next login tries again.
          this.dummyHashPromise = null;
          throw error;
        },
      );
    }
    return this.dummyHashPromise;
  }
}

// Unset means the default. A set value must be a whole number in range, otherwise the
// app fails at startup instead of hashing with a cost nobody chose.
function parseBcryptCost(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_BCRYPT_COST;
  }
  const cost = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(cost >= MIN_BCRYPT_COST && cost <= MAX_BCRYPT_COST)) {
    throw new Error(
      `BCRYPT_COST must be a whole number from ${MIN_BCRYPT_COST} to ${MAX_BCRYPT_COST}, got '${raw}'`,
    );
  }
  return cost;
}
