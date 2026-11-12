import { buildMessage, ValidateBy, ValidationOptions } from 'class-validator';

// Password rules shared by ACC-01, ACC-07a, ACC-08 and ACC-13 so the rules stay identical.

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores everything after 72 bytes, so a longer password would be silently truncated.
export const PASSWORD_MAX_BYTES = 72;

export const IS_VALID_PASSWORD = 'isValidPassword';

const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;

/**
 * Returns null when the password is valid, otherwise the message for the first rule it breaks.
 * The value is never trimmed or modified.
 */
export function passwordRuleViolation(value: unknown): string | null {
  if (typeof value !== 'string') {
    return 'password must be a string';
  }
  // Array.from splits by code point, so an emoji counts as one character, not two UTF-16 units.
  if (Array.from(value).length < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (!LETTER.test(value)) {
    return 'password must contain at least one letter';
  }
  if (!DIGIT.test(value)) {
    return 'password must contain at least one digit';
  }
  if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) {
    return `password must be at most ${PASSWORD_MAX_BYTES} bytes`;
  }
  return null;
}

/** The value must pass every password rule. The message names the first rule it breaks. */
export function IsValidPassword(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_VALID_PASSWORD,
      validator: {
        validate: (value): boolean => passwordRuleViolation(value) === null,
        defaultMessage: buildMessage(
          (eachPrefix, args) =>
            `${eachPrefix}${passwordRuleViolation(args?.value) ?? 'password is invalid'}`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
