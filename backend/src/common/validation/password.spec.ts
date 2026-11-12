import { validate } from 'class-validator';
import {
  IsValidPassword,
  PASSWORD_MAX_BYTES,
  passwordRuleViolation,
} from './password';
import { flattenValidationErrors } from './validation-exception.factory';

const TOO_SHORT = 'password must be at least 8 characters';
const NO_LETTER = 'password must contain at least one letter';
const NO_DIGIT = 'password must contain at least one digit';
const TOO_LONG = 'password must be at most 72 bytes';
const NOT_STRING = 'password must be a string';

class RegisterDto {
  @IsValidPassword()
  password: unknown;
}

// Runs class-validator and returns the errors in the GEN-02 response format.
async function fieldErrors(password: unknown) {
  const dto = Object.assign(new RegisterDto(), { password });
  return flattenValidationErrors(await validate(dto));
}

describe('passwordRuleViolation', () => {
  it.each(['abcdefg1', 'كلمةسر12'])('accepts %s', (value) => {
    expect(passwordRuleViolation(value)).toBeNull();
  });

  it.each([
    ['abc1', TOO_SHORT],
    ['abcdefgh', NO_DIGIT],
    ['12345678', NO_LETTER],
    [12345678, NOT_STRING],
    [undefined, NOT_STRING],
  ])('rejects %s', (value, message) => {
    expect(passwordRuleViolation(value)).toBe(message);
  });

  it('accepts exactly 72 ASCII bytes', () => {
    const value = 'a'.repeat(PASSWORD_MAX_BYTES - 1) + '1';
    expect(Buffer.byteLength(value, 'utf8')).toBe(72);
    expect(passwordRuleViolation(value)).toBeNull();
  });

  it('rejects 73 ASCII bytes', () => {
    const value = 'a'.repeat(PASSWORD_MAX_BYTES) + '1';
    expect(passwordRuleViolation(value)).toBe(TOO_LONG);
  });

  it('counts bytes, not characters: 41 characters of Arabic is over 72 bytes', () => {
    const value = 'ب'.repeat(40) + '1';
    expect(Array.from(value)).toHaveLength(41);
    expect(Buffer.byteLength(value, 'utf8')).toBe(81);
    expect(passwordRuleViolation(value)).toBe(TOO_LONG);
  });

  it('counts code points, not UTF-16 units', () => {
    // 6 + 1 emoji = 7 code points but 8 UTF-16 units: still too short.
    const sevenCodePoints = 'abcde1😀';
    expect(sevenCodePoints).toHaveLength(8);
    expect(passwordRuleViolation(sevenCodePoints)).toBe(TOO_SHORT);

    // 7 + 1 emoji = 8 code points: long enough.
    expect(passwordRuleViolation('abcdef1😀')).toBeNull();
  });

  it('does not trim: surrounding spaces count and the value is unchanged', () => {
    const value = ' abcdef1 ';
    expect(passwordRuleViolation(value)).toBeNull();
    expect(value).toBe(' abcdef1 ');
  });
});

describe('IsValidPassword', () => {
  it('accepts a valid password', async () => {
    await expect(fieldErrors('abcdefg1')).resolves.toEqual([]);
  });

  it('leaves the value untouched', async () => {
    const dto = Object.assign(new RegisterDto(), { password: ' abcdef1 ' });
    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.password).toBe(' abcdef1 ');
  });

  it.each([
    ['abc1', TOO_SHORT],
    ['abcdefgh', NO_DIGIT],
    ['12345678', NO_LETTER],
    ['a'.repeat(72) + '1', TOO_LONG],
    [12345678, NOT_STRING],
  ])('reports %s with the specific rule message', async (value, message) => {
    await expect(fieldErrors(value)).resolves.toEqual([
      { field: 'password', messages: [message] },
    ]);
  });
});
