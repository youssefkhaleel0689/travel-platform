import { decimal128ToString } from '../common/money/money';
import {
  Activity,
  ActivityImage,
  BudgetEntry,
  Itinerary,
  ItineraryDay,
  TransportCost,
} from './schemas/itinerary.schema';
import { dateOfDay, groupConsecutiveDays } from './itinerary-days.logic';

export function toActivityImageView(i: ActivityImage) {
  return {
    id: i._id.toString(),
    url: i.url,
    mimeType: i.mimeType,
    sizeBytes: i.sizeBytes,
    uploadedAt: i.uploadedAt,
  };
}

export function toActivityView(a: Activity) {
  return {
    id: a._id.toString(),
    name: a.name,
    description: a.description ?? null,
    time: a.time ?? null,
    cost: decimal128ToString(a.cost),
    currency: a.currency ?? null,
    // ITN-12. Activities saved before images existed have no array yet.
    images: (a.images ?? []).map(toActivityImageView),
  };
}

export function toBudgetEntryView(b: BudgetEntry) {
  return {
    id: b._id.toString(),
    category: b.category,
    amount: decimal128ToString(b.amount),
    currency: b.currency,
  };
}

export function toTransportCostView(t: TransportCost) {
  return {
    id: t._id.toString(),
    mode: t.mode,
    fromCity: t.fromCity,
    toCity: t.toCity,
    amount: decimal128ToString(t.amount),
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
    // ITN-27: confirmed bookings linked to this day, with price snapshots.
    bookingLinks: (day.bookingLinks ?? []).map((link) => ({
      bookingType: link.bookingType,
      bookingId: link.bookingId.toString(),
      amount: decimal128ToString(link.amount),
      currency: link.currency,
      reference: link.reference ?? null,
      label: link.label ?? null,
    })),
  };
}

// Works for hydrated documents and for .lean() results.
type ItineraryLike = Pick<
  Itinerary,
  | '_id'
  | 'userId'
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
    ownerId: doc.userId.toString(),
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
