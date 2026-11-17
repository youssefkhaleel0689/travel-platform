import { Injectable } from '@nestjs/common';
import type { Types } from 'mongoose';
import { AirlinePoliciesService } from '../policies/airline-policies.service';
import type { PolicySnapshot } from '../schemas/flight-booking.schema';

/**
 * The airline terms a new booking is made under (FLT-08, FLT-09, PAY-02): the policy of
 * the outbound airline, copied into the booking so a later edit never changes it.
 *
 * An airline that has never defined a policy gets version 0: no extra bags for sale and
 * no cancellation tiers, so a cancellation would refund 0% (FLT-09). A stored policy
 * starts at version 1, so 0 can never be mistaken for a real one.
 */
@Injectable()
export class FlightBookingPolicyReader {
  constructor(private readonly airlinePolicies: AirlinePoliciesService) {}

  async snapshotFor(airlineId: Types.ObjectId): Promise<PolicySnapshot> {
    const policy = await this.airlinePolicies.getForAirline(airlineId);
    if (!policy) {
      return {
        airlineId,
        version: 0,
        extraBagPrice: null,
        maxExtraBagsPerPassenger: null,
        cancellationTiers: [],
      };
    }
    // Fields copied one by one: the snapshot must not carry the policy's _id,
    // updatedBy or timestamps.
    return {
      airlineId,
      version: policy.version,
      extraBagPrice: policy.extraBagPrice,
      maxExtraBagsPerPassenger: policy.maxExtraBagsPerPassenger,
      cancellationTiers: policy.cancellationTiers.map((tier) => ({
        daysBeforeDeparture: tier.daysBeforeDeparture,
        refundPercentage: tier.refundPercentage,
      })),
    };
  }
}
