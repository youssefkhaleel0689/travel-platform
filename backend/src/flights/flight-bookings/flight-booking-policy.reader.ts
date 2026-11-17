import { Injectable } from '@nestjs/common';
import type { Types } from 'mongoose';
import type { PolicySnapshot } from '../schemas/flight-booking.schema';

/**
 * The airline terms a new booking is made under (FLT-08, FLT-09, PAY-02): the policy of
 * the outbound airline, copied into the booking so a later edit never changes it.
 *
 * TODO(FLT-08): build the snapshot from AirlinePoliciesService.getForAirline() once the
 * airline policies PR (feature/FLT-08-FLT-09-airline-policies) is merged. Until then every
 * airline counts as having no policy: version 0, no extra bags for sale and no cancellation
 * tiers, so a cancellation would refund 0% (FLT-09). Only this class changes then.
 */
@Injectable()
export class FlightBookingPolicyReader {
  snapshotFor(airlineId: Types.ObjectId): Promise<PolicySnapshot> {
    return Promise.resolve({
      airlineId,
      version: 0,
      extraBagPrice: null,
      maxExtraBagsPerPassenger: null,
      cancellationTiers: [],
    });
  }
}
