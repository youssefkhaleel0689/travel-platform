import { Types } from 'mongoose';
import type { AirlinePoliciesService } from '../policies/airline-policies.service';
import type { AirlinePolicy } from '../schemas/airline-policy.schema';
import { FlightBookingPolicyReader } from './flight-booking-policy.reader';

const AIRLINE_ID = new Types.ObjectId();

function reader(policy: Partial<AirlinePolicy> | null) {
  const airlinePolicies = {
    getForAirline: jest.fn(() => Promise.resolve(policy)),
  };
  return {
    reader: new FlightBookingPolicyReader(
      airlinePolicies as unknown as AirlinePoliciesService,
    ),
    airlinePolicies,
  };
}

describe('FlightBookingPolicyReader (FLT-08, FLT-09, PAY-02)', () => {
  it("copies the airline's current policy into the snapshot", async () => {
    const { reader: policies, airlinePolicies } = reader({
      _id: new Types.ObjectId(),
      airlineId: AIRLINE_ID,
      version: 3,
      extraBagPrice: Types.Decimal128.fromString('15.00'),
      maxExtraBagsPerPassenger: 2,
      cancellationTiers: [
        { daysBeforeDeparture: 7, refundPercentage: 80 },
        { daysBeforeDeparture: 0, refundPercentage: 0 },
      ],
      updatedBy: new Types.ObjectId(),
    });

    const snapshot = await policies.snapshotFor(AIRLINE_ID);

    expect(airlinePolicies.getForAirline).toHaveBeenCalledWith(AIRLINE_ID);
    // Exactly these keys: no _id, updatedBy or timestamps.
    expect(snapshot).toEqual({
      airlineId: AIRLINE_ID,
      version: 3,
      extraBagPrice: Types.Decimal128.fromString('15.00'),
      maxExtraBagsPerPassenger: 2,
      cancellationTiers: [
        { daysBeforeDeparture: 7, refundPercentage: 80 },
        { daysBeforeDeparture: 0, refundPercentage: 0 },
      ],
    });
  });

  it('keeps a cancellation-only policy without extra bags', async () => {
    const { reader: policies } = reader({
      airlineId: AIRLINE_ID,
      version: 1,
      extraBagPrice: null,
      maxExtraBagsPerPassenger: null,
      cancellationTiers: [{ daysBeforeDeparture: 3, refundPercentage: 50 }],
    });

    await expect(policies.snapshotFor(AIRLINE_ID)).resolves.toMatchObject({
      version: 1,
      extraBagPrice: null,
      maxExtraBagsPerPassenger: null,
    });
  });

  it('gives version 0 and no terms to an airline that has no policy yet', async () => {
    const { reader: policies } = reader(null);

    await expect(policies.snapshotFor(AIRLINE_ID)).resolves.toEqual({
      airlineId: AIRLINE_ID,
      version: 0,
      extraBagPrice: null,
      maxExtraBagsPerPassenger: null,
      cancellationTiers: [],
    });
  });
});
