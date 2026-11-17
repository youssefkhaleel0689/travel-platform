import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

async function check(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProfileDto, payload);
  const errors = await validate(dto, { whitelist: true });
  return {
    dto,
    fields: errors.map((error) => error.property),
  };
}

describe('UpdateProfileDto (ACC-09)', () => {
  it('accepts an empty body: nothing is changed', async () => {
    const { fields } = await check({});
    expect(fields).toEqual([]);
  });

  describe('name', () => {
    it('trims the value before validating', async () => {
      const { dto, fields } = await check({ name: '  Taher Khalaf  ' });

      expect(fields).toEqual([]);
      expect(dto.name).toBe('Taher Khalaf');
    });

    it('rejects a name that is only whitespace', async () => {
      const { fields } = await check({ name: '   ' });
      expect(fields).toEqual(['name']);
    });

    it('rejects a name over 100 characters', async () => {
      const { fields } = await check({ name: 'a'.repeat(101) });
      expect(fields).toEqual(['name']);
    });
  });

  describe('phone', () => {
    it.each([
      ['+201234567890', '+201234567890'],
      ['01234567890', '01234567890'],
      ['+20 (123) 456-7890', '+201234567890'],
    ])('accepts %s and normalises it to %s', async (input, expected) => {
      const { dto, fields } = await check({ phone: input });

      expect(fields).toEqual([]);
      expect(dto.phone).toBe(expected);
    });

    it('accepts null, which clears the number', async () => {
      const { dto, fields } = await check({ phone: null });

      expect(fields).toEqual([]);
      expect(dto.phone).toBeNull();
    });

    it.each(['12345', 'not-a-phone', '+1234567890123456789'])(
      'rejects %s',
      async (phone) => {
        const { fields } = await check({ phone });
        expect(fields).toEqual(['phone']);
      },
    );
  });

  describe('preferredCurrency', () => {
    it('upper-cases the code', async () => {
      const { dto, fields } = await check({ preferredCurrency: 'egp' });

      expect(fields).toEqual([]);
      expect(dto.preferredCurrency).toBe('EGP');
    });

    it('accepts null, which clears the preference', async () => {
      const { dto, fields } = await check({ preferredCurrency: null });

      expect(fields).toEqual([]);
      expect(dto.preferredCurrency).toBeNull();
    });

    // The format is checked here so the client gets a field-level error; the
    // service then checks the code is actually seeded (GEN-12).
    it.each(['EG', 'EGPP', '12E'])('rejects %s', async (preferredCurrency) => {
      const { fields } = await check({ preferredCurrency });
      expect(fields).toEqual(['preferredCurrency']);
    });
  });
});
