import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PASSWORD_MAX_BYTES } from '../../common/validation/password';

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
