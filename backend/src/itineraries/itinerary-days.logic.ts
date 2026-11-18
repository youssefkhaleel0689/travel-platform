// Pure helpers (no database) so the day rules can be unit tested.

export const MAX_DAYS = 60; // ITN-05
const DAY_MS = 24 * 60 * 60 * 1000;

// Day numbers and dates are never stored: they come from the position of the
// day and the itinerary start date (ITN-05, 07, 08).
export function dateOfDay(startDate: Date, index: number): string {
  return new Date(startDate.getTime() + index * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// Returns a new array with the element at `from` moved to index `to`.
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export interface DayGroup {
  city: string;
  fromDay: number;
  toDay: number;
  dayCount: number;
  startDate: string;
  endDate: string;
  dayIds: string[];
}

// ITN-09: consecutive days in the same city form one group.
export function groupConsecutiveDays(
  days: { id: string; city: string }[],
  startDate: Date,
): DayGroup[] {
  const groups: DayGroup[] = [];
  days.forEach((day, index) => {
    const last = groups[groups.length - 1];
    if (last && last.city === day.city) {
      last.toDay = index + 1;
      last.dayCount += 1;
      last.endDate = dateOfDay(startDate, index);
      last.dayIds.push(day.id);
    } else {
      groups.push({
        city: day.city,
        fromDay: index + 1,
        toDay: index + 1,
        dayCount: 1,
        startDate: dateOfDay(startDate, index),
        endDate: dateOfDay(startDate, index),
        dayIds: [day.id],
      });
    }
  });
  return groups;
}
