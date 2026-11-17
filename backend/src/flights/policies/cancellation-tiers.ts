import type { CancellationTier } from '../schemas/airline-policy.schema';

/**
 * FLT-09: the refund percentage for a cancellation `daysRemaining` days before departure.
 * The tier with the highest threshold that does not exceed the days remaining applies; if
 * no tier applies the refund is 0%. The caller decides how days are counted (whole days
 * between now and the departure). Used by the refund quote and the cancellation (FLT-26).
 */
export function refundPercentageFor(
  tiers: readonly CancellationTier[],
  daysRemaining: number,
): number {
  let best: CancellationTier | undefined;
  for (const tier of tiers) {
    if (
      tier.daysBeforeDeparture <= daysRemaining &&
      (best === undefined ||
        tier.daysBeforeDeparture > best.daysBeforeDeparture)
    ) {
      best = tier;
    }
  }
  return best?.refundPercentage ?? 0;
}
