import { refundPercentageFor } from './cancellation-tiers';

const TIERS = [
  { daysBeforeDeparture: 14, refundPercentage: 100 },
  { daysBeforeDeparture: 7, refundPercentage: 50 },
  { daysBeforeDeparture: 1, refundPercentage: 10 },
];

describe('refundPercentageFor (FLT-09)', () => {
  it('uses the tier with the highest threshold not exceeding the days remaining', () => {
    expect(refundPercentageFor(TIERS, 30)).toBe(100);
    expect(refundPercentageFor(TIERS, 10)).toBe(50);
    expect(refundPercentageFor(TIERS, 3)).toBe(10);
  });

  it('applies a tier when the days remaining equal its threshold', () => {
    expect(refundPercentageFor(TIERS, 14)).toBe(100);
    expect(refundPercentageFor(TIERS, 7)).toBe(50);
    expect(refundPercentageFor(TIERS, 1)).toBe(10);
  });

  it('is 0% when no tier applies', () => {
    expect(refundPercentageFor(TIERS, 0)).toBe(0);
    expect(refundPercentageFor([], 20)).toBe(0);
  });

  it('does not depend on the order of the tiers', () => {
    expect(refundPercentageFor([...TIERS].reverse(), 10)).toBe(50);
  });

  it('can give a 0% tier priority over a lower-threshold paying tier', () => {
    expect(
      refundPercentageFor(
        [
          { daysBeforeDeparture: 0, refundPercentage: 20 },
          { daysBeforeDeparture: 2, refundPercentage: 0 },
        ],
        5,
      ),
    ).toBe(0);
  });

  it('is 0% for negative days remaining', () => {
    expect(
      refundPercentageFor(
        [{ daysBeforeDeparture: 0, refundPercentage: 50 }],
        -1,
      ),
    ).toBe(0);
  });
});
