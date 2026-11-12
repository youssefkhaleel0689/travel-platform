import { ConfigService } from '@nestjs/config';

export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * Reads the HS256 signing secret and fails fast at startup when it is unusable.
 * Whoever knows the secret can sign a token for any user, so the error messages never
 * include the value or any part of it.
 */
export function readJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (secret === undefined || secret === '') {
    throw new Error('JWT_SECRET is required');
  }
  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters`,
    );
  }
  return secret;
}
