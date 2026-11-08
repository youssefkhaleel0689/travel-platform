import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  describe('hash and verify', () => {
    // bcrypt with 12 rounds is deliberately slow; these two tests need more
    // than Jest's default 5 seconds.
    const SLOW = 20_000;

    it('verifies a password against its own hash', async () => {
      const hash = await service.hash('GoodPass1');

      expect(hash).not.toContain('GoodPass1');
      await expect(service.verify('GoodPass1', hash)).resolves.toBe(true);
    }, SLOW);

    it('rejects a wrong password and is salted per hash', async () => {
      const first = await service.hash('GoodPass1');
      const second = await service.hash('GoodPass1');

      // Different salts, so the same password never produces the same hash.
      expect(first).not.toEqual(second);
      await expect(service.verify('BadPass1', first)).resolves.toBe(false);
    }, SLOW);
  });

  describe('satisfiesPolicy (ACC-01, ACC-08)', () => {
    it.each(['Abcdefg1', 'LongerPassword9', '1a345678'])(
      'accepts %s',
      (password) => {
        expect(service.satisfiesPolicy(password)).toBe(true);
      },
    );

    it.each([
      ['Abcdef1', 'too short'],
      ['abcdefghij', 'no digit'],
      ['1234567890', 'no letter'],
      ['', 'empty'],
    ])('rejects %s (%s)', (password) => {
      expect(service.satisfiesPolicy(password)).toBe(false);
    });
  });

  describe('generateTemporaryPassword (ACC-07a)', () => {
    it('always satisfies the password policy', () => {
      for (let i = 0; i < 50; i += 1) {
        const generated = service.generateTemporaryPassword();
        expect(service.satisfiesPolicy(generated)).toBe(true);
      }
    });

    it('does not repeat itself', () => {
      const generated = new Set(
        Array.from({ length: 20 }, () => service.generateTemporaryPassword()),
      );
      expect(generated.size).toBe(20);
    });
  });
});
