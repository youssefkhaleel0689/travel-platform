export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/** Half-open interval overlap: [a.start, a.end) vs [b.start, b.end). */
export function overlaps(a: DateRange, b: DateRange): boolean {
  return a.startDate < b.endDate && a.endDate > b.startDate;
}

/**
 * True when the union of `ranges` covers every night of [from, to).
 * Adjacent ranges (end == next start) count as contiguous.
 */
export function isFullyCovered(ranges: DateRange[], from: Date, to: Date): boolean {
  const sorted = [...ranges].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  let cursor = from.getTime();
  for (const r of sorted) {
    if (r.endDate.getTime() <= cursor) continue;
    if (r.startDate.getTime() > cursor) return false;
    cursor = r.endDate.getTime();
    if (cursor >= to.getTime()) return true;
  }
  return cursor >= to.getTime();
}

/** The parts of `old` that are no longer covered by `next` (used when shrinking availability). */
export function removedParts(old: DateRange, next: DateRange): DateRange[] {
  const parts: DateRange[] = [];
  if (old.startDate < next.startDate) {
    parts.push({ startDate: old.startDate, endDate: new Date(Math.min(old.endDate.getTime(), next.startDate.getTime())) });
  }
  if (next.endDate < old.endDate) {
    parts.push({ startDate: new Date(Math.max(old.startDate.getTime(), next.endDate.getTime())), endDate: old.endDate });
  }
  return parts.filter((p) => p.endDate > p.startDate);
}
