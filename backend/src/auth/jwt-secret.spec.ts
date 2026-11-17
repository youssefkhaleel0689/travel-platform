import { ConfigService } from '@nestjs/config';
import { JWT_SECRET_MIN_LENGTH, readJwtSecret } from './jwt-secret';

// A ConfigService that only knows the values given here. The real one falls back to
// process.env for unset keys, which would make these tests depend on the machine.
function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
}

// The message thrown for this config, or null when nothing is thrown.
function errorMessage(values: Record<string, string>): string | null {
  try {
    readJwtSecret(configWith(values));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// Distinctive characters, so a leak of any part of the value would be visible.
const SECRET_32 = 'Qz7#Vw2!Lp9$Rk4%Tn6&Hx8*Bm3^Jd5@';
const SECRET_31 = SECRET_32.slice(0, 31);

describe('readJwtSecret (ACC-04)', () => {
  it('uses 32 as the minimum length', () => {
    expect(JWT_SECRET_MIN_LENGTH).toBe(32);
    expect(SECRET_32).toHaveLength(32);
  });

  it('returns a secret of exactly 32 characters', () => {
    expect(readJwtSecret(configWith({ JWT_SECRET: SECRET_32 }))).toBe(
      SECRET_32,
    );
  });

  it('rejects a missing secret', () => {
    expect(errorMessage({})).toBe('JWT_SECRET is required');
  });

  it('rejects an empty secret', () => {
    expect(errorMessage({ JWT_SECRET: '' })).toBe('JWT_SECRET is required');
  });

  it('rejects a secret of 31 characters', () => {
    expect(errorMessage({ JWT_SECRET: SECRET_31 })).toBe(
      'JWT_SECRET must be at least 32 characters',
    );
  });

  it('never puts the value or a part of it in the message', () => {
    const message = errorMessage({ JWT_SECRET: SECRET_31 }) ?? '';
    expect(message).not.toContain(SECRET_31);
    // Any 4 consecutive characters of the value.
    for (let i = 0; i + 4 <= SECRET_31.length; i += 1) {
      expect(message).not.toContain(SECRET_31.slice(i, i + 4));
    }
  });
});
