import Decimal from 'decimal.js';
import { convertAmount } from '../exchange-rates/convert';
import { dateOfDay, groupConsecutiveDays } from './itinerary-days.logic';

// Pure calculation (no database, no network) so it can be unit tested.
// Money is added as Decimal and shown as a string with 2 decimals (half up),
// never as a JavaScript float, like every other amount in the API.

export const SUMMARY_CATEGORIES = [
  'food',
  'accommodation',
  'local_transport',
  'activities',
  'intercity_transport', // kept separate from local transport (ITN-14, ITN-16)
] as const;
export type SummaryCategory = (typeof SUMMARY_CATEGORIES)[number];
type Totals = Record<SummaryCategory, Decimal>;
export type ShownTotals = Record<SummaryCategory, string>;

export interface SummaryDayInput {
  id: string;
  city: string;
  budgetEntries: { category: string; amount: string; currency: string }[];
  activities: { cost?: string | null; currency?: string | null }[];
  // ITN-27: confirmed bookings linked to the day feed the budget.
  bookingLinks?: {
    bookingType: string;
    amount: string;
    currency: string;
  }[];
}

export interface SummaryTransportInput {
  amount: string;
  currency: string;
  dayId: string;
}

const emptyTotals = (): Totals => ({
  food: new Decimal(0),
  accommodation: new Decimal(0),
  local_transport: new Decimal(0),
  activities: new Decimal(0),
  intercity_transport: new Decimal(0),
});

const show = (value: Decimal): string =>
  value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

const showTotals = (t: Totals): ShownTotals =>
  Object.fromEntries(
    SUMMARY_CATEGORIES.map((c) => [c, show(t[c])]),
  ) as ShownTotals;

const sum = (t: Totals): Decimal =>
  SUMMARY_CATEGORIES.reduce((s, c) => s.plus(t[c]), new Decimal(0));

export function computeBudgetSummary(input: {
  days: SummaryDayInput[];
  transportCosts: SummaryTransportInput[];
  startDate: Date;
  currency: string;
  rates: Record<string, number>;
}) {
  const { days, transportCosts, startDate, currency, rates } = input;
  const convert = (amount: string, from: string) =>
    convertAmount(amount, from, currency, rates);

  const perDay = new Map<string, Totals>(
    days.map((d) => [d.id, emptyTotals()]),
  );

  for (const day of days) {
    const totals = perDay.get(day.id)!;
    for (const entry of day.budgetEntries) {
      const category = entry.category as SummaryCategory;
      totals[category] = totals[category].plus(
        convert(entry.amount, entry.currency),
      );
    }
    // An activity cost counts under "activities" (ITN-14)
    for (const activity of day.activities) {
      if (activity.cost != null && activity.currency) {
        totals.activities = totals.activities.plus(
          convert(activity.cost, activity.currency),
        );
      }
    }
    // ITN-27: linked hotel reservations count as accommodation, flights as
    // intercity transport. The amount is the snapshot taken when linking.
    for (const link of day.bookingLinks ?? []) {
      const category: SummaryCategory =
        link.bookingType === 'HOTEL' ? 'accommodation' : 'intercity_transport';
      totals[category] = totals[category].plus(
        convert(link.amount, link.currency),
      );
    }
  }
  for (const cost of transportCosts) {
    const totals = perDay.get(cost.dayId);
    if (totals) {
      totals.intercity_transport = totals.intercity_transport.plus(
        convert(cost.amount, cost.currency),
      );
    }
  }

  const overall = emptyTotals();
  for (const totals of perDay.values()) {
    for (const c of SUMMARY_CATEGORIES) overall[c] = overall[c].plus(totals[c]);
  }

  const byDay = days.map((day, index) => {
    const totals = perDay.get(day.id)!;
    return {
      dayId: day.id,
      dayNumber: index + 1,
      date: dateOfDay(startDate, index),
      city: day.city,
      total: show(sum(totals)),
      byCategory: showTotals(totals),
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
    total: show(
      g.dayIds.reduce((s, id) => s.plus(sum(perDay.get(id)!)), new Decimal(0)),
    ),
  }));

  return {
    currency,
    total: show(sum(overall)),
    byCategory: showTotals(overall),
    byDay,
    byCityGroup,
  };
}
