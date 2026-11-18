import { Types } from 'mongoose';
import type { AirportDto } from '../../common/reference-data/dto/airport.dto';
import type { AirlinePolicy } from '../schemas/airline-policy.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import { toFlightDetailsDto } from './flight-details.mapper';

const FLIGHT_ID = new Types.ObjectId();
const AIRLINE = {
  id: new Types.ObjectId().toString(),
  name: 'EgyptAir',
  iataCode: 'MS',
};
const CAI: AirportDto = {
  id: 'CAI',
  name: 'Cairo International Airport',
  cityId: 'cairo',
  countryId: 'EG',
  timeZone: 'Africa/Cairo',
};
const DXB: AirportDto = {
  id: 'DXB',
  name: 'Dubai International Airport',
  cityId: 'dubai',
  countryId: 'AE',
  timeZone: 'Asia/Dubai',
};

function cabin(
  category: CabinCategory,
  price: string,
  counts: { total: number; booked: number; held: number },
) {
  return {
    category,
    totalSeats: counts.total,
    bookedSeats: counts.booked,
    heldSeats: counts.held,
    price: Types.Decimal128.fromString(price),
    freeBaggageCount: 1,
    maxBagWeightKg: 23,
  };
}

// CAI -> DXB on 2026-12-20: 08:30 in Cairo (UTC+2), 14:30 in Dubai (UTC+4).
function flight(): Flight {
  return {
    _id: FLIGHT_ID,
    airlineId: new Types.ObjectId(AIRLINE.id),
    flightNumber: 'MS910',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAtUtc: new Date('2026-12-20T06:30:00.000Z'),
    arrivalAtUtc: new Date('2026-12-20T10:30:00.000Z'),
    departureDateKey: '2026-12-20',
    status: FlightStatus.SCHEDULED,
    cabinInventory: [
      cabin(CabinCategory.ECONOMY, '199.99', {
        total: 150,
        booked: 100,
        held: 8,
      }),
      cabin(CabinCategory.BUSINESS, '750.00', {
        total: 20,
        booked: 20,
        held: 0,
      }),
    ],
  } as unknown as Flight;
}

function policy(overrides: Partial<AirlinePolicy> = {}): AirlinePolicy {
  return {
    extraBagPrice: Types.Decimal128.fromString('15.00'),
    maxExtraBagsPerPassenger: 2,
    // Stored in any order here, to prove the details page sorts them.
    cancellationTiers: [
      { daysBeforeDeparture: 0, refundPercentage: 0 },
      { daysBeforeDeparture: 14, refundPercentage: 100 },
      { daysBeforeDeparture: 7, refundPercentage: 50 },
    ],
    version: 2,
    ...overrides,
  } as AirlinePolicy;
}

describe('toFlightDetailsDto (FLT-17)', () => {
  it('shows the flight with local times, duration and both airports', () => {
    const details = toFlightDetailsDto(flight(), AIRLINE, CAI, DXB, policy());

    expect(details).toMatchObject({
      id: FLIGHT_ID.toString(),
      status: FlightStatus.SCHEDULED,
      airline: AIRLINE,
      flightNumber: 'MS910',
      departureAirport: CAI,
      arrivalAirport: DXB,
      departureLocalTime: '2026-12-20T08:30:00+02:00',
      arrivalLocalTime: '2026-12-20T14:30:00+04:00',
      departureAtUtc: '2026-12-20T06:30:00.000Z',
      arrivalAtUtc: '2026-12-20T10:30:00.000Z',
      durationMinutes: 240,
    });
  });

  it('shows each cabin with its price, seats remaining and baggage, never the counters', () => {
    const details = toFlightDetailsDto(flight(), AIRLINE, CAI, DXB, policy());

    expect(details.cabins).toEqual([
      {
        category: CabinCategory.ECONOMY,
        pricePerSeat: '199.99',
        seatsRemaining: 42,
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
      {
        category: CabinCategory.BUSINESS,
        pricePerSeat: '750.00',
        seatsRemaining: 0,
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
    ]);
  });

  it('never shows fewer than 0 seats, even if the counters disagree', () => {
    const broken = flight();
    broken.cabinInventory[0].heldSeats = 60;

    const details = toFlightDetailsDto(broken, AIRLINE, CAI, DXB, null);

    expect(details.cabins[0].seatsRemaining).toBe(0);
  });

  it("shows the airline's extra bags and its tiers from the most days to the fewest", () => {
    const details = toFlightDetailsDto(flight(), AIRLINE, CAI, DXB, policy());

    expect(details.policy).toEqual({
      extraBagPrice: '15.00',
      maxExtraBagsPerPassenger: 2,
      cancellationTiers: [
        { daysBeforeDeparture: 14, refundPercentage: 100 },
        { daysBeforeDeparture: 7, refundPercentage: 50 },
        { daysBeforeDeparture: 0, refundPercentage: 0 },
      ],
    });
  });

  it('shows no extra bags and no refund when the airline has no policy', () => {
    const details = toFlightDetailsDto(flight(), AIRLINE, CAI, DXB, null);

    expect(details.policy).toEqual({
      extraBagPrice: null,
      maxExtraBagsPerPassenger: null,
      cancellationTiers: [],
    });
  });

  it('keeps a cancellation-only policy without extra bags', () => {
    const details = toFlightDetailsDto(
      flight(),
      AIRLINE,
      CAI,
      DXB,
      policy({ extraBagPrice: null, maxExtraBagsPerPassenger: null }),
    );

    expect(details.policy.extraBagPrice).toBeNull();
    expect(details.policy.cancellationTiers).toHaveLength(3);
  });
});
