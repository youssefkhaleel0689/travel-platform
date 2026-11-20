import {
  dateOfDay,
  groupConsecutiveDays,
  moveItem,
} from './itinerary-days.logic';

const start = new Date('2026-12-30');

describe('dateOfDay', () => {
  it('derives dates from the start date, across month and year ends', () => {
    expect(dateOfDay(start, 0)).toBe('2026-12-30');
    expect(dateOfDay(start, 2)).toBe('2027-01-01');
    expect(dateOfDay(new Date('2028-02-28'), 1)).toBe('2028-02-29');
  });
});

describe('moveItem', () => {
  it('moves forward and backward without changing the input', () => {
    const input = ['a', 'b', 'c', 'd'];
    expect(moveItem(input, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(input, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(input, 1, 1)).toEqual(['a', 'b', 'c', 'd']);
    expect(input).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('groupConsecutiveDays', () => {
  it('groups consecutive days in the same city', () => {
    const groups = groupConsecutiveDays(
      [
        { id: '1', city: 'london' },
        { id: '2', city: 'london' },
        { id: '3', city: 'paris' },
        { id: '4', city: 'london' },
      ],
      start,
    );
    expect(groups.map((g) => [g.city, g.dayCount, g.fromDay, g.toDay])).toEqual(
      [
        ['london', 2, 1, 2],
        ['paris', 1, 3, 3],
        ['london', 1, 4, 4],
      ],
    );
    expect(groups[0].startDate).toBe('2026-12-30');
    expect(groups[0].endDate).toBe('2026-12-31');
    expect(groups[0].dayIds).toEqual(['1', '2']);
  });

  it('returns no groups for no days', () => {
    expect(groupConsecutiveDays([], start)).toEqual([]);
  });
});
