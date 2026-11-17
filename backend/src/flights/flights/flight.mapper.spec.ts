import { Types } from 'mongoose';
import { durationMinutes, toFlightDto } from './flight.mapper';
import {
  CabinCategory,
  CabinInventory,
  Flight,
  FlightStatus,
} from '../schemas/flight.schema';

const FLIGHT_ID = new Types.ObjectId();
const AIRLINE_ID = new Types.ObjectId();
const NOW = new Date('2026-11-12T10:00:00.000Z');

function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    _id: FLIGHT_ID,
    airlineId: AIRLINE_ID,
    flightNumber: 'MS777',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureLocalInput: '2026-12-20T08:30',
    arrivalLocalInput: '2026-12-20T14:30',
    departureAtUtc: new Date('2026-12-20T06:30:00.000Z'),
    arrivalAtUtc: new Date('2026-12-20T10:30:00.000Z'),
    departureDateKey: '2026-12-20',
    status: FlightStatus.SCHEDULED,
    cabinInventory: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('toFlightDto (FLT-03)', () => {
  it('maps every public field and computes the duration from the UTC instants', () => {
    expect(toFlightDto(flight())).toEqual({
      id: FLIGHT_ID.toString(),
      airlineId: AIRLINE_ID.toString(),
      flightNumber: 'MS777',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2026-12-20T08:30',
      arrivalLocalInput: '2026-12-20T14:30',
      departureAtUtc: '2026-12-20T06:30:00.000Z',
      arrivalAtUtc: '2026-12-20T10:30:00.000Z',
      departureDateKey: '2026-12-20',
      durationMinutes: 240,
      status: 'SCHEDULED',
      cabinInventory: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it('maps cabins and shows Decimal128 prices as strings', () => {
    const cabin = {
      category: CabinCategory.ECONOMY,
      totalSeats: 150,
      bookedSeats: 2,
      heldSeats: 1,
      price: Types.Decimal128.fromString('199.99'),
      freeBaggageCount: 1,
      maxBagWeightKg: 23,
    } satisfies CabinInventory;
    const dto = toFlightDto(flight({ cabinInventory: [cabin] }));
    expect(dto.cabinInventory).toEqual([{ ...cabin, price: '199.99' }]);
  });

  it('does not expose fields that are not listed in the DTO', () => {
    const extra = Object.assign(flight(), { secret: 'x' });
    expect(toFlightDto(extra)).not.toHaveProperty('secret');
  });
});

describe('durationMinutes', () => {
  it('is the difference of the two instants in minutes', () => {
    expect(
      durationMinutes(
        new Date('2026-12-20T06:30:00.000Z'),
        new Date('2026-12-20T09:05:00.000Z'),
      ),
    ).toBe(155);
  });

  it('counts a flight that crosses midnight and a date change correctly', () => {
    expect(
      durationMinutes(
        new Date('2026-12-20T22:00:00.000Z'),
        new Date('2026-12-21T01:30:00.000Z'),
      ),
    ).toBe(210);
  });
});
