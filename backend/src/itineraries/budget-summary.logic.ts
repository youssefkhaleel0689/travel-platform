import { convertAmount } from '../exchange-rates/convert';
import { dateOfDay, groupConsecutiveDays } from './itinerary-days.logic';

// Pure calculation (no database, no network) so it can be unit tested.

export const SUMMARY_CATEGORIES = [
  'food',
  'accommodation',
  'local_transport',
  'activities',
  'intercity_transport', // kept separate from local transport (ITN-14, ITN-16)
] as const;
export type SummaryCategory = (typeof SUMMARY_CATEGORIES)[number];
type Totals = Record<SummaryCategory, number>;

export interface SummaryDayInput {
  id: string;
  city: string;
  budgetEntries: { category: string; amount: number; currency: string }[];
  activities: { cost?: number | null; currency?: string | null }[];
}

export interface SummaryTransportInput {
  amount: number;
  currency: string;
  dayId: string;
}

const emptyTotals = (): Totals => ({
  food: 0,
  accommodation: 0,
  local_transport: 0,
  activities: 0,
  intercity_transport: 0,
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const roundTotals = (t: Totals): Totals =>
  Object.fromEntries(
    SUMMARY_CATEGORIES.map((c) => [c, round2(t[c])]),
  ) as Totals;

const sum = (t: Totals) => SUMMARY_CATEGORIES.reduce((s, c) => s + t[c], 0);

export function computeBudgetSummary(input: {
  days: SummaryDayInput[];
  transportCosts: SummaryTransportInput[];
  startDate: Date;
  currency: string;
  rates: Record<string, number>;
}) {
  const { days, transportCosts, startDate, currency, rates } = input;
  const convert = (amount: number, from: string) =>
    convertAmount(amount, from, currency, rates);

  const perDay = new Map<string, Totals>(
    days.map((d) => [d.id, emptyTotals()]),
  );

  for (const day of days) {
    const totals = perDay.get(day.id)!;
    for (const entry of day.budgetEntries) {
      totals[entry.category as SummaryCategory] += convert(
        entry.amount,
        entry.currency,
      );
    }
    // An activity cost counts under "activities" (ITN-14)
    for (const activity of day.activities) {
      if (activity.cost != null && activity.currency) {
        totals.activities += convert(activity.cost, activity.currency);
      }
    }
  }
  for (const cost of transportCosts) {
    const totals = perDay.get(cost.dayId);
    if (totals) {
      totals.intercity_transport += convert(cost.amount, cost.currency);
    }
  }

  const overall = emptyTotals();
  for (const totals of perDay.values()) {
    for (const c of SUMMARY_CATEGORIES) overall[c] += totals[c];
  }

  const byDay = days.map((day, index) => {
    const totals = perDay.get(day.id)!;
    return {
      dayId: day.id,
      dayNumber: index + 1,
      date: dateOfDay(startDate, index),
      city: day.city,
      total: round2(sum(totals)),
      byCategory: roundTotals(totals),
    };
  });

  const byCityGroup = groupConsecutiveDays(
    days.map((d) => ({ id: d.id, city: d.city })),
    startDate,
  ).map((g) => ({
    city: g.city,
    fromDay: g.fromDay,
    toDay: g.toDay,
    dayCount: g.dayCount,
    total: round2(g.dayIds.reduce((s, id) => s + sum(perDay.get(id)!), 0)),
  }));

  return {
    currency,
    total: round2(sum(overall)),
    byCategory: roundTotals(overall),
    byDay,
    byCityGroup,
  };
}
