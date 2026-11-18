import {
  Activity,
  BudgetEntry,
  Itinerary,
  ItineraryDay,
  TransportCost,
} from './schemas/itinerary.schema';
import { dateOfDay, groupConsecutiveDays } from './itinerary-days.logic';

export function toActivityView(a: Activity) {
  return {
    id: a._id.toString(),
    name: a.name,
    description: a.description ?? null,
    time: a.time ?? null,
    cost: a.cost ?? null,
    currency: a.currency ?? null,
  };
}

export function toBudgetEntryView(b: BudgetEntry) {
  return {
    id: b._id.toString(),
    category: b.category,
    amount: b.amount,
    currency: b.currency,
  };
}

export function toTransportCostView(t: TransportCost) {
  return {
    id: t._id.toString(),
    mode: t.mode,
    fromCity: t.fromCity,
    toCity: t.toCity,
    amount: t.amount,
    currency: t.currency,
    dayId: t.dayId.toString(),
  };
}

function toDayView(day: ItineraryDay, index: number, startDate: Date) {
  return {
    id: day._id.toString(),
    dayNumber: index + 1,
    date: dateOfDay(startDate, index),
    city: day.city,
    notes: day.notes ?? null,
    activities: day.activities.map(toActivityView),
    budgetEntries: day.budgetEntries.map(toBudgetEntryView),
  };
}

// Works for hydrated documents and for .lean() results.
type ItineraryLike = Pick<
  Itinerary,
  | '_id'
  | 'owner'
  | 'title'
  | 'countries'
  | 'startDate'
  | 'visibility'
  | 'days'
  | 'transportCosts'
  | 'clonedFrom'
  | 'createdAt'
  | 'updatedAt'
>;

export function toItineraryView(doc: ItineraryLike) {
  const days = doc.days.map((d, i) => toDayView(d, i, doc.startDate));
  return {
    id: doc._id.toString(),
    ownerId: doc.owner.toString(),
    title: doc.title,
    countries: doc.countries,
    startDate: doc.startDate.toISOString().slice(0, 10),
    visibility: doc.visibility,
    days,
    cityGroups: groupConsecutiveDays(
      days.map((d) => ({ id: d.id, city: d.city })),
      doc.startDate,
    ),
    transportCosts: doc.transportCosts.map(toTransportCostView),
    clonedFrom: doc.clonedFrom
      ? {
          itineraryId: doc.clonedFrom.itineraryId.toString(),
          authorId: doc.clonedFrom.authorId.toString(),
        }
      : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

type SummaryLike = Pick<
  Itinerary,
  '_id' | 'title' | 'countries' | 'startDate' | 'visibility' | 'updatedAt'
> & { days: { city: string }[] };

export function toItinerarySummary(doc: SummaryLike) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    countries: doc.countries,
    startDate: doc.startDate.toISOString().slice(0, 10),
    dayCount: doc.days.length,
    visibility: doc.visibility,
    updatedAt: doc.updatedAt,
  };
}
