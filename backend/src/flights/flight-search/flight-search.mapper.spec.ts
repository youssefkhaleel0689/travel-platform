import { Types } from 'mongoose';
import { CabinCategory } from '../schemas/flight.schema';
import {
  type FlightMatch,
  toFlightSearchItemDto,
} from './flight-search.mapper';

const AIRLINE = {
  id: new Types.ObjectId().toString(),
  name: 'EgyptAir',
  iataCode: 'MS',
};

// CAI -> DXB in January: Cairo is on UTC+2 and Dubai on UTC+4.
function flight(overrides: Partial<FlightMatch> = {}): FlightMatch {
  return {
    _id: new Types.ObjectId(),
    airlineId: new Types.ObjectId(AIRLINE.id),
    flightNumber: 'MS910',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAtUtc: new Date('2027-01-15T06:00:00.000Z'),
    arrivalAtUtc: new Date('2027-01-15T09:30:00.000Z'),
    cabins: [
      {
        category: CabinCategory.ECONOMY,
        price: Types.Decimal128.fromString('180.5'),
        freeSeats: 3,
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
      {
        category: CabinCategory.BUSINESS,
        price: Types.Decimal128.fromString('900.00'),
        freeSeats: 12,
        freeBaggageCount: 2,
        maxBagWeightKg: 32,
      },
    ],
    lowestPrice: Types.Decimal128.fromString('180.5'),
    ...overrides,
  };
}

describe('toFlightSearchItemDto', () => {
  it('shows each time in the local time of its own airport', () => {
    const dto = toFlightSearchItemDto(
      flight(),
      AIRLINE,
      'Africa/Cairo',
      'Asia/Dubai',
    );

    expect(dto.departureLocalTime).toBe('2027-01-15T08:00:00+02:00');
    expect(dto.arrivalLocalTime).toBe('2027-01-15T13:30:00+04:00');
    expect(dto.departureAtUtc).toBe('2027-01-15T06:00:00.000Z');
    expect(dto.arrivalAtUtc).toBe('2027-01-15T09:30:00.000Z');
  });

  it('computes the duration from the UTC instants, not from the local clocks', () => {
    const dto = toFlightSearchItemDto(
      flight(),
      AIRLINE,
      'Africa/Cairo',
      'Asia/Dubai',
    );

    // The local clocks differ by 5h30, but the flight takes 3h30.
    expect(dto.durationMinutes).toBe(210);
  });

  it('keeps prices as the exact decimal strings', () => {
    const dto = toFlightSearchItemDto(
      flight(),
      AIRLINE,
      'Africa/Cairo',
      'Asia/Dubai',
    );

    expect(dto.lowestPrice).toBe('180.5');
    expect(dto.cabins.map((c) => c.pricePerSeat)).toEqual(['180.5', '900.00']);
  });

  it('returns only the public fields, without airlineId or seat counters', () => {
    const match = flight();
    const dto = toFlightSearchItemDto(
      match,
      AIRLINE,
      'Africa/Cairo',
      'Asia/Dubai',
    );

    expect(dto).toEqual({
      id: match._id.toString(),
      airline: AIRLINE,
      flightNumber: 'MS910',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalTime: '2027-01-15T08:00:00+02:00',
      arrivalLocalTime: '2027-01-15T13:30:00+04:00',
      departureAtUtc: '2027-01-15T06:00:00.000Z',
      arrivalAtUtc: '2027-01-15T09:30:00.000Z',
      durationMinutes: 210,
      lowestPrice: '180.5',
      cabins: [
        {
          category: CabinCategory.ECONOMY,
          pricePerSeat: '180.5',
          seatsAvailable: 3,
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
        {
          category: CabinCategory.BUSINESS,
          pricePerSeat: '900.00',
          seatsAvailable: 12,
          freeBaggageCount: 2,
          maxBagWeightKg: 32,
        },
      ],
    });
  });
});
