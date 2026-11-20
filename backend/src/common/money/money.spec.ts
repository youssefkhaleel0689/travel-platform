import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  addMoney,
  decimal128ToString,
  formatMoney,
  fromMinorUnits,
  isGreaterThan,
  isZero,
  parseMoney,
  percentageOf,
  PLATFORM_CURRENCY,
  toDecimal128,
  toMinorUnits,
} from './money';

describe('money (PAY-04)', () => {
  it('fixes the platform currency as USD', () => {
    expect(PLATFORM_CURRENCY).toBe('USD');
  });

  describe('parseMoney', () => {
    it.each(['0', '0.00', '199.99', '1000000.01'])('accepts %s', (amount) => {
      expect(parseMoney(amount).toFixed(2)).toBe(Number(amount).toFixed(2));
    });

    it.each(['-1.00', 'abc', '', 'NaN', 'Infinity'])('rejects %s', (amount) => {
      expect(() => parseMoney(amount)).toThrow(InternalServerErrorException);
    });

    it('rejects more than 2 decimal places, instead of silently rounding', () => {
      expect(() => parseMoney('1.005')).toThrow(InternalServerErrorException);
    });
  });

  describe('formatMoney', () => {
    it.each([
      ['5', '5.00'],
      ['5.1', '5.10'],
      ['199.99', '199.99'],
      ['0', '0.00'],
    ])('writes %s as %s', (input, expected) => {
      expect(formatMoney(input)).toBe(expected);
    });
  });

  describe('toMinorUnits', () => {
    it.each([
      ['0.00', 0],
      ['0.01', 1],
      ['1.00', 100],
      ['199.99', 19999],
      ['10.10', 1010],
      ['1234.56', 123456],
    ])('turns %s into %i cents', (amount, expected) => {
      expect(toMinorUnits(amount)).toBe(expected);
    });

    // Why the helper is not ceremony: multiplying by 100 as a double is not
    // exact, so the naive conversion is wrong for ordinary prices.
    it.each([
      ['19.99', 1999, 1998.9999999999998],
      ['8.21', 821, 821.0000000000001],
      ['1.13', 113, 112.99999999999999],
    ])(
      '%s is exactly %i cents, where a float gives %f',
      (amount, expected, floatResult) => {
        expect(Number(amount) * 100).toBe(floatResult);
        expect(Number(amount) * 100).not.toBe(expected);
        expect(toMinorUnits(amount)).toBe(expected);
      },
    );

    it('refuses an amount too large to charge exactly', () => {
      expect(() => toMinorUnits('999999999999999999')).toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('fromMinorUnits', () => {
    it.each([
      [0, '0.00'],
      [1, '0.01'],
      [19999, '199.99'],
      [123456, '1234.56'],
    ])('turns %i cents into %s', (minor, expected) => {
      expect(fromMinorUnits(minor)).toBe(expected);
    });

    it('round-trips every amount', () => {
      for (const amount of ['0.00', '0.01', '7.35', '199.99', '12345.67']) {
        expect(fromMinorUnits(toMinorUnits(amount))).toBe(amount);
      }
    });
  });

  describe('percentageOf (PAY-03)', () => {
    it.each([
      ['100.00', 100, '100.00'],
      ['100.00', 50, '50.00'],
      ['100.00', 0, '0.00'],
      ['199.99', 50, '100.00'],
      ['0.01', 50, '0.01'],
      ['33.33', 25, '8.33'],
    ])('%s at %i%% is %s', (amount, percentage, expected) => {
      expect(percentageOf(amount, percentage)).toBe(expected);
    });

    it('rounds half up, like an invoice', () => {
      // 99.99 * 25% = 24.9975 -> 25.00
      expect(percentageOf('99.99', 25)).toBe('25.00');
    });

    it('never returns more than was captured', () => {
      expect(percentageOf('10.00', 100)).toBe('10.00');
      expect(
        parseMoney(percentageOf('0.01', 100)).lessThanOrEqualTo(
          parseMoney('0.01'),
        ),
      ).toBe(true);
    });

    it.each([-1, 101, 12.5, Number.NaN])(
      'rejects a percentage of %s',
      (percentage) => {
        expect(() => percentageOf('100.00', percentage)).toThrow(
          BadRequestException,
        );
      },
    );
  });

  describe('arithmetic and comparison', () => {
    it('adds without float error', () => {
      expect(addMoney('0.10', '0.20')).toBe('0.30');
      expect(0.1 + 0.2).not.toBe(0.3);
    });

    it('compares amounts', () => {
      expect(isGreaterThan('10.01', '10.00')).toBe(true);
      expect(isGreaterThan('10.00', '10.00')).toBe(false);
      expect(isZero('0.00')).toBe(true);
      expect(isZero('0.01')).toBe(false);
    });
  });

  describe('Decimal128 conversion', () => {
    it('round-trips through the stored type', () => {
      const stored = toDecimal128('199.99');

      expect(stored).toBeInstanceOf(Types.Decimal128);
      expect(decimal128ToString(stored)).toBe('199.99');
    });

    it('normalises to 2 decimals on the way in and out', () => {
      expect(decimal128ToString(toDecimal128('5'))).toBe('5.00');
      expect(decimal128ToString(Types.Decimal128.fromString('5.1'))).toBe(
        '5.10',
      );
    });

    it('passes null through', () => {
      expect(decimal128ToString(null)).toBeNull();
      expect(decimal128ToString(undefined)).toBeNull();
    });
  });
});
