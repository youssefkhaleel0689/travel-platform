import { computeBudgetSummary } from './budget-summary.logic';

const rates = { USD: 1, EUR: 0.9, GBP: 0.8, EGP: 50 };
const startDate = new Date('2026-12-20');

const days = [
  {
    id: 'd1',
    city: 'paris',
    budgetEntries: [{ category: 'food', amount: '90.00', currency: 'EUR' }],
    activities: [
      { cost: '45.00', currency: 'EUR' },
      { cost: null, currency: null },
    ],
  },
  {
    id: 'd2',
    city: 'paris',
    budgetEntries: [
      { category: 'accommodation', amount: '100.00', currency: 'USD' },
    ],
    activities: [],
  },
  { id: 'd3', city: 'london', budgetEntries: [], activities: [] },
];
const transportCosts = [{ amount: '80.00', currency: 'GBP', dayId: 'd1' }];

describe('computeBudgetSummary', () => {
  it('converts every item and totals by category, day and city group', () => {
    const s = computeBudgetSummary({
      days,
      transportCosts,
      startDate,
      currency: 'USD',
      rates,
    });
    expect(s.total).toBe('350.00');
    expect(s.byCategory).toEqual({
      food: '100.00',
      accommodation: '100.00',
      local_transport: '0.00',
      activities: '50.00', // activity costs count under "activities"
      intercity_transport: '100.00', // kept separate from local transport
    });
    expect(s.byDay.map((d) => d.total)).toEqual(['250.00', '100.00', '0.00']);
    expect(s.byDay[0]).toMatchObject({ dayNumber: 1, date: '2026-12-20' });
    expect(s.byCityGroup).toEqual([
      { city: 'paris', fromDay: 1, toDay: 2, dayCount: 2, total: '350.00' },
      { city: 'london', fromDay: 3, toDay: 3, dayCount: 1, total: '0.00' },
    ]);
  });

  it('shows everything in the chosen display currency', () => {
    const s = computeBudgetSummary({
      days,
      transportCosts,
      startDate,
      currency: 'EGP',
      rates,
    });
    expect(s.currency).toBe('EGP');
    expect(s.total).toBe('17500.00');
  });

  it('handles an empty itinerary', () => {
    const s = computeBudgetSummary({
      days: [],
      transportCosts: [],
      startDate,
      currency: 'USD',
      rates,
    });
    expect(s.total).toBe('0.00');
    expect(s.byDay).toEqual([]);
    expect(s.byCityGroup).toEqual([]);
  });

  it('ignores a transport cost whose day no longer exists', () => {
    const s = computeBudgetSummary({
      days,
      transportCosts: [{ amount: '999.00', currency: 'USD', dayId: 'gone' }],
      startDate,
      currency: 'USD',
      rates,
    });
    expect(s.byCategory.intercity_transport).toBe('0.00');
  });

  it('rounds to 2 decimals', () => {
    const s = computeBudgetSummary({
      days: [
        {
          id: 'd1',
          city: 'paris',
          budgetEntries: [
            { category: 'food', amount: '10.00', currency: 'EUR' },
          ],
          activities: [],
        },
      ],
      transportCosts: [],
      startDate,
      currency: 'USD',
      rates,
    });
    expect(s.total).toBe('11.11'); // 10 / 0.9
  });
});
