import { Types } from 'mongoose';
import { Itinerary, Visibility } from './schemas/itinerary.schema';

// ITN-21: an independent private copy that keeps attribution.
// Every day, activity, budget entry and transport cost gets a NEW id, so the
// copy and the original never share anything. Transport costs are re-pointed
// to the new day ids.
export function buildCloneData(source: Itinerary, newOwner: Types.ObjectId) {
  const newDayIds = new Map<string, Types.ObjectId>();

  const days = source.days.map((day) => {
    const newId = new Types.ObjectId();
    newDayIds.set(day._id.toString(), newId);
    return {
      _id: newId,
      city: day.city,
      notes: day.notes,
      activities: day.activities.map((a) => ({
        name: a.name,
        description: a.description,
        time: a.time,
        cost: a.cost,
        currency: a.currency,
      })),
      budgetEntries: day.budgetEntries.map((b) => ({
        category: b.category,
        amount: b.amount,
        currency: b.currency,
      })),
    };
  });

  const transportCosts = source.transportCosts
    .filter((t) => newDayIds.has(t.dayId.toString()))
    .map((t) => ({
      mode: t.mode,
      fromCity: t.fromCity,
      toCity: t.toCity,
      amount: t.amount,
      currency: t.currency,
      dayId: newDayIds.get(t.dayId.toString())!,
    }));

  return {
    owner: newOwner,
    title: source.title,
    countries: [...source.countries],
    startDate: source.startDate,
    visibility: Visibility.PRIVATE,
    days,
    transportCosts,
    clonedFrom: { itineraryId: source._id, authorId: source.owner },
  };
}
