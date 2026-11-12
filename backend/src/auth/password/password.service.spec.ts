import { ConfigService } from '@nestjs/config';
import { PasswordService } from './password.service';

// A ConfigService that only knows the values given here. The real one falls back to
// process.env for unset keys, which would make these tests depend on the machine.
function serviceWith(values: Record<string, string>): PasswordService {
  const config = {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
  return new PasswordService(config);
}

describe('PasswordService', () => {
  // Cost 4 is the lowest bcrypt allows, which keeps these tests fast.
  const service = serviceWith({ BCRYPT_COST: '4' });

  it('hashes with the configured cost', async () => {
    const passwordHash = await service.hash('abcdefg1');
    expect(passwordHash.startsWith('$2b$04$')).toBe(true);
    expect(passwordHash).toHaveLength(60);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const passwordHash = await service.hash('abcdefg1');
    await expect(service.verify('abcdefg1', passwordHash)).resolves.toBe(true);
    await expect(service.verify('abcdefg2', passwordHash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const first = await service.hash('abcdefg1');
    const second = await service.hash('abcdefg1');
    expect(first).not.toBe(second);
  });

  it('rejects a password over 72 bytes instead of truncating it', async () => {
    await expect(service.hash('a'.repeat(72) + '1')).rejects.toThrow(
      '72 bytes',
    );
  });

  describe('the 72-byte bcrypt limit', () => {
    const seventyTwoBytes = 'a'.repeat(71) + '1';

    it('hashes and verifies a password of exactly 72 bytes', async () => {
      expect(Buffer.byteLength(seventyTwoBytes, 'utf8')).toBe(72);
      const passwordHash = await service.hash(seventyTwoBytes);
      await expect(service.verify(seventyTwoBytes, passwordHash)).resolves.toBe(
        true,
      );
    });

    it('rejects the stored 72 bytes plus extra characters, which bcrypt would truncate into a match', async () => {
      const passwordHash = await service.hash(seventyTwoBytes);
      await expect(
        service.verify(seventyTwoBytes + 'x', passwordHash),
      ).resolves.toBe(false);
    });
  });

  describe('verifyDummy (unknown email at login)', () => {
    it.each(['abcdefg1', '', 'a'.repeat(100)])(
      'always resolves false for %p',
      async (plain) => {
        const fresh = serviceWith({ BCRYPT_COST: '4' });
        await expect(fresh.verifyDummy(plain)).resolves.toBe(false);
      },
    );

    it('compares against a real bcrypt hash with the configured cost', async () => {
      const fresh = serviceWith({ BCRYPT_COST: '4' });
      const hashSpy = jest.spyOn(fresh, 'hash');
      const verifySpy = jest.spyOn(fresh, 'verify');
      await fresh.verifyDummy('abcdefg1');

      const dummy = await hashSpy.mock.results[0].value;
      expect(dummy).toMatch(/^\$2b\$04\$/);
      expect(verifySpy).toHaveBeenCalledWith('abcdefg1', dummy);
    });

    it('makes the dummy hash only once, even for concurrent first calls', async () => {
      const fresh = serviceWith({ BCRYPT_COST: '4' });
      const hashSpy = jest.spyOn(fresh, 'hash');
      await Promise.all([
        fresh.verifyDummy('first1aa'),
        fresh.verifyDummy('second1a'),
      ]);
      await fresh.verifyDummy('third1aa');

      expect(hashSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('defaults the cost to 12 when BCRYPT_COST is unset', () => {
    expect(serviceWith({}).cost).toBe(12);
  });

  it.each(['4', '15'])('accepts BCRYPT_COST %s', (value) => {
    expect(serviceWith({ BCRYPT_COST: value }).cost).toBe(Number(value));
  });

  it.each(['abc', '3', '16', '12.5', ''])(
    'fails at startup when BCRYPT_COST is %p',
    (value) => {
      expect(() => serviceWith({ BCRYPT_COST: value })).toThrow('BCRYPT_COST');
    },
  );
});
