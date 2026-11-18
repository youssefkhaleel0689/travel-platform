import {
  AirlinePolicy,
  CancellationTier,
} from '../schemas/airline-policy.schema';
import { AirlinePolicyDto } from './dto/airline-policy.dto';

// Highest threshold first, the order the refund rule reads them in (FLT-09).
export function sortTiers(
  tiers: readonly CancellationTier[],
): CancellationTier[] {
  return [...tiers].sort(
    (a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture,
  );
}

// Fields are listed one by one so updatedBy and any future field are never exposed by accident.
export function toAirlinePolicyDto(doc: AirlinePolicy): AirlinePolicyDto {
  return {
    airlineId: doc.airlineId.toString(),
    extraBagPrice: doc.extraBagPrice ? doc.extraBagPrice.toString() : null,
    maxExtraBagsPerPassenger: doc.maxExtraBagsPerPassenger ?? null,
    cancellationTiers: sortTiers(doc.cancellationTiers ?? []).map((tier) => ({
      daysBeforeDeparture: tier.daysBeforeDeparture,
      refundPercentage: tier.refundPercentage,
    })),
    version: doc.version,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
