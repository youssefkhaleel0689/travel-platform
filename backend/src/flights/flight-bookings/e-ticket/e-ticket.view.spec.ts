import { BookingStatus } from '../../schemas/flight-booking.schema';
import { CabinCategory } from '../../schemas/flight.schema';
import { PassengerType, TripType } from '../../schemas/flight-booking.schema';
import type { FlightBookingDto } from '../dto/flight-booking-response.dto';
import {
  formatDuration,
  formatLocalTime,
  toETicketView,
} from './e-ticket.view';

const AIRLINE_ID = '6afe0ceb7447cce6a2bfca98';

// A confirmed one-way booking: two adults, one infant, one extra bag.
function booking(overrides: Partial<FlightBookingDto> = {}): FlightBookingDto {
  return {
    id: '6afe108ceb774075534728dc',
    status: BookingStatus.CONFIRMED,
    holdExpiresAt: '2026-11-18T21:04:34.824Z',
    bookingReference: 'K7Q2PX',
    createdAt: '2026-11-18T20:54:36.091Z',
    tripType: TripType.ONE_WAY,
    segments: [
      {
        flightId: '6afe0ceb7447cce6a2bfca9d',
        airlineId: AIRLINE_ID,
        flightNumber: 'KD100',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        departureLocalTime: '2026-12-20T08:30:00+02:00',
        arrivalLocalTime: '2026-12-20T14:30:00+04:00',
        departureAtUtc: '2026-12-20T06:30:00.000Z',
        arrivalAtUtc: '2026-12-20T10:30:00.000Z',
        durationMinutes: 240,
        cabin: CabinCategory.ECONOMY,
        pricePerSeat: '199.99',
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
    ],
    passengers: [
      {
        fullName: 'Khaled Elshitany',
        dateOfBirth: '1990-05-14',
        passengerType: PassengerType.ADULT,
        documentNumber: '•••••5678',
        fare: '199.99',
        extraBags: { count: 1, weightKg: 20, fee: '15.00' },
      },
      {
        fullName: 'Omar Elshitany',
        dateOfBirth: '2025-08-01',
        passengerType: PassengerType.INFANT,
        documentNumber: '•••••3344',
        fare: '20.00',
        extraBags: null,
      },
    ],
    policy: {
      airlineId: AIRLINE_ID,
      version: 1,
      extraBagPrice: '15.00',
      maxExtraBagsPerPassenger: 2,
      cancellationTiers: [
        { daysBeforeDeparture: 0, refundPercentage: 0 },
        { daysBeforeDeparture: 7, refundPercentage: 80 },
      ],
    },
    price: {
      subtotal: '219.99',
      baggageTotal: '15.00',
      total: '234.99',
      currency: 'USD',
    },
    ...overrides,
  };
}

const NAMES = {
  airlines: new Map([[AIRLINE_ID, 'KE Demo Air']]),
  airports: new Map([
    ['CAI', 'Cairo International Airport'],
    ['DXB', 'Dubai International Airport'],
  ]),
};
const ISSUED_AT = new Date('2026-11-18T21:05:00.000Z');

describe('formatLocalTime', () => {
  it('rearranges an airport-local ISO time without converting it', () => {
    expect(formatLocalTime('2026-12-20T08:30:00+02:00')).toBe(
      '20 Dec 2026, 08:30 (UTC+02:00)',
    );
    expect(formatLocalTime('2026-01-05T23:59:00-05:00')).toBe(
      '5 Jan 2026, 23:59 (UTC-05:00)',
    );
  });

  it('reads a UTC instant with milliseconds', () => {
    expect(formatLocalTime('2026-11-18T21:05:00.000Z')).toBe(
      '18 Nov 2026, 21:05 (UTC+00:00)',
    );
  });

  it('can leave the offset out', () => {
    expect(formatLocalTime('2026-12-20T08:30:00+02:00', false)).toBe(
      '20 Dec 2026, 08:30',
    );
  });

  it('leaves anything it does not recognise as it is', () => {
    expect(formatLocalTime('not a time')).toBe('not a time');
  });
});

describe('formatDuration', () => {
  it('prints hours and two-digit minutes', () => {
    expect(formatDuration(240)).toBe('4h 00m');
    expect(formatDuration(95)).toBe('1h 35m');
    expect(formatDuration(45)).toBe('0h 45m');
  });
});

describe('toETicketView (FLT-23)', () => {
  it('prints the reference, the flight with names and local times, and the price', () => {
    const view = toETicketView(booking(), NAMES, ISSUED_AT);

    expect(view).toMatchObject({
      bookingReference: 'K7Q2PX',
      issuedOn: '18 Nov 2026, 21:05 (UTC+00:00)',
      tripType: 'One way',
      price: {
        subtotal: '219.99 USD',
        baggage: '15.00 USD',
        total: '234.99 USD',
      },
    });
    expect(view.segments).toEqual([
      {
        flightNumber: 'KD100',
        airlineName: 'KE Demo Air',
        from: 'Cairo International Airport (CAI)',
        to: 'Dubai International Airport (DXB)',
        departure: '20 Dec 2026, 08:30 (UTC+02:00)',
        arrival: '20 Dec 2026, 14:30 (UTC+04:00)',
        duration: '4h 00m',
        cabin: 'ECONOMY',
        baggage: '1 bag included, up to 23 kg each',
      },
    ]);
  });

  it('prints each passenger with the masked document number and any extra bags', () => {
    const view = toETicketView(booking(), NAMES, ISSUED_AT);

    expect(view.passengers).toEqual([
      {
        fullName: 'Khaled Elshitany',
        passengerType: 'ADULT',
        documentNumber: '•••••5678',
        fare: '199.99 USD',
        extraBags: '1 extra bag, up to 20 kg each (15.00 USD)',
      },
      {
        fullName: 'Omar Elshitany',
        passengerType: 'INFANT',
        documentNumber: '•••••3344',
        fare: '20.00 USD',
        extraBags: null,
      },
    ]);
  });

  it('lists the cancellation tiers from the most days to the fewest', () => {
    const view = toETicketView(booking(), NAMES, ISSUED_AT);

    expect(view.cancellation).toEqual([
      '7 days or more before departure: 80% refund',
      'Up to departure: 0% refund',
    ]);
  });

  it('says there is no refund when the airline has no tiers', () => {
    const view = toETicketView(
      booking({
        policy: {
          airlineId: AIRLINE_ID,
          version: 0,
          extraBagPrice: null,
          maxExtraBagsPerPassenger: null,
          cancellationTiers: [],
        },
      }),
      NAMES,
      ISSUED_AT,
    );

    expect(view.cancellation).toEqual(['No refund on cancellation.']);
  });

  it('marks a round trip and falls back to the code when a name is unknown', () => {
    const view = toETicketView(
      booking({ tripType: TripType.ROUND_TRIP }),
      { airlines: new Map(), airports: new Map() },
      ISSUED_AT,
    );

    expect(view.tripType).toBe('Round trip');
    expect(view.segments[0]).toMatchObject({
      airlineName: '',
      from: 'CAI',
      to: 'DXB',
    });
  });
});
