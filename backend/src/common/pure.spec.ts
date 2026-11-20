import { isFullyCovered, overlaps, removedParts } from './ranges';
import {
  centsToString,
  pickRefundPercentage,
  refundCents,
  toCents,
} from './money';

const d = (s: string) => new Date(s + 'T00:00:00.000Z');
const r = (a: string, b: string) => ({ startDate: d(a), endDate: d(b) });

describe('ranges', () => {
  it('half-open overlap: adjacent ranges do not overlap', () => {
    expect(
      overlaps(r('2026-12-01', '2026-12-05'), r('2026-12-05', '2026-12-08')),
    ).toBe(false);
    expect(
      overlaps(r('2026-12-01', '2026-12-05'), r('2026-12-04', '2026-12-08')),
    ).toBe(true);
  });
  it('coverage across contiguous AVAILABLE ranges', () => {
    const av = [r('2026-12-01', '2026-12-10'), r('2026-12-10', '2026-12-20')];
    expect(isFullyCovered(av, d('2026-12-05'), d('2026-12-15'))).toBe(true);
    expect(isFullyCovered(av, d('2026-12-05'), d('2026-12-21'))).toBe(false);
    expect(
      isFullyCovered(
        [r('2026-12-01', '2026-12-05'), r('2026-12-06', '2026-12-10')],
        d('2026-12-02'),
        d('2026-12-08'),
      ),
    ).toBe(false); // gap night
    expect(isFullyCovered([], d('2026-12-02'), d('2026-12-08'))).toBe(false);
  });
  it('removedParts when shrinking / moving', () => {
    expect(
      removedParts(
        r('2026-12-01', '2026-12-10'),
        r('2026-12-03', '2026-12-08'),
      ),
    ).toHaveLength(2);
    expect(
      removedParts(
        r('2026-12-01', '2026-12-10'),
        r('2026-12-01', '2026-12-12'),
      ),
    ).toHaveLength(0);
    const far = removedParts(
      r('2026-12-01', '2026-12-10'),
      r('2027-01-01', '2027-01-05'),
    );
    expect(far).toEqual([r('2026-12-01', '2026-12-10')]);
  });
});

describe('money', () => {
  it('uses exact cents', () => {
    expect(toCents('0.10') + toCents('0.20')).toBe(30n);
    expect(centsToString(toCents('120.5') * 3n)).toBe('361.50');
  });
  it('refund rounding half-up and tier choice', () => {
    expect(centsToString(refundCents(toCents('100.00'), 50))).toBe('50.00');
    expect(centsToString(refundCents(toCents('33.33'), 33.33))).toBe('11.11');
    const tiers = [
      { daysBeforeCheckIn: 7, refundPercentage: 100 },
      { daysBeforeCheckIn: 2, refundPercentage: 50 },
    ];
    expect(pickRefundPercentage(tiers, 10)).toBe(100);
    expect(pickRefundPercentage(tiers, 3)).toBe(50);
    expect(pickRefundPercentage(tiers, 1)).toBe(0);
  });
});
