import { dayAfter } from './itinerary-hotels.logic';

describe('dayAfter (ITN-25 check-out)', () => {
  it.each([
    ['2026-12-20', '2026-12-21'],
    ['2026-11-30', '2026-12-01'],
    ['2026-01-31', '2026-02-01'],
    ['2026-12-31', '2027-01-01'],
    ['2027-02-28', '2027-03-01'],
    ['2028-02-28', '2028-02-29'],
    ['2028-02-29', '2028-03-01'],
  ])('the day after %s is %s', (date, next) => {
    expect(dayAfter(date)).toBe(next);
  });

  // Cairo moves its clocks in spring and autumn; UTC never does.
  it('ignores daylight saving changes', () => {
    expect(dayAfter('2026-03-28')).toBe('2026-03-29');
    expect(dayAfter('2026-10-31')).toBe('2026-11-01');
  });
});
