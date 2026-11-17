import { PassengerType } from '../schemas/flight-booking.schema';
import {
  fareFor,
  passengerTypeOn,
  priceBooking,
} from './flight-booking-pricing';

const { ADULT, CHILD, INFANT } = PassengerType;

describe('passengerTypeOn (FLT-12)', () => {
  // The departure date is 2026-12-20 in every row but the leap-year ones.
  it.each([
    ['turns 12 on the departure date', '2014-12-20', ADULT],
    ['turns 12 the day after', '2014-12-21', CHILD],
    ['turns 2 on the departure date', '2024-12-20', CHILD],
    ['turns 2 the day after', '2024-12-21', INFANT],
    ['is born on the departure date', '2026-12-20', INFANT],
    ['is 40', '1986-01-01', ADULT],
  ])('someone who %s is %s', (_case, dateOfBirth, type) => {
    expect(passengerTypeOn(dateOfBirth, '2026-12-20')).toBe(type);
  });

  it('returns null for someone born after the departure date', () => {
    expect(passengerTypeOn('2026-12-21', '2026-12-20')).toBeNull();
  });

  it('makes someone born on 29 February a year older from 1 March', () => {
    expect(passengerTypeOn('2024-02-29', '2026-02-28')).toBe(INFANT);
    expect(passengerTypeOn('2024-02-29', '2026-03-01')).toBe(CHILD);
  });

  it('throws on a date that is not on the calendar: the callers validate them', () => {
    expect(() => passengerTypeOn('2004-02-30', '2026-12-20')).toThrow();
  });
});

describe('fareFor (FLT-12)', () => {
  it.each([
    [ADULT, '199.99', '199.99'],
    [CHILD, '199.99', '199.99'],
    [ADULT, '100', '100.00'],
    // 10% of 199.99 is 19.999, rounded half up to the cent.
    [INFANT, '199.99', '20.00'],
    // 10% of 0.05 is 0.005: half up gives 0.01, not 0.00.
    [INFANT, '0.05', '0.01'],
  ])('%s on a %s cabin pays %s', (type, price, fare) => {
    expect(fareFor(type, price)).toBe(fare);
  });
});

describe('priceBooking (FLT-19, FLT-21)', () => {
  const adult = { passengerType: ADULT, extraBagCount: 0 };
  const infant = { passengerType: INFANT, extraBagCount: 0 };

  it('prices a one-way trip for two adults and an infant', () => {
    expect(priceBooking(['199.99'], [adult, adult, infant], null)).toEqual({
      fares: ['199.99', '199.99', '20.00'],
      bagFees: ['0.00', '0.00', '0.00'],
      subtotal: '419.98',
      baggageTotal: '0.00',
      total: '419.98',
    });
  });

  it('adds up each segment of a round trip, rounding the infant per segment', () => {
    // Infant: 20.00 out (19.999) + 15.01 back (15.005).
    const price = priceBooking(['199.99', '150.05'], [adult, infant], null);
    expect(price.fares).toEqual(['350.04', '35.01']);
    expect(price.total).toBe('385.05');
  });

  it('charges each extra bag once per segment at the booking bag price', () => {
    const price = priceBooking(
      ['199.99', '150.05'],
      [{ passengerType: ADULT, extraBagCount: 2 }, infant],
      '25.50',
    );
    // 2 bags x 25.50 x 2 segments.
    expect(price.bagFees).toEqual(['102.00', '0.00']);
    expect(price.baggageTotal).toBe('102.00');
    expect(price.total).toBe('487.05');
  });

  it('adds exactly, without floating-point drift', () => {
    // 0.1 + 0.1 + 0.1 is 0.30000000000000004 with numbers.
    expect(priceBooking(['0.10'], [adult, adult, adult], null).total).toBe(
      '0.30',
    );
  });

  it('refuses to price extra bags without a bag price: the service checks first', () => {
    expect(() =>
      priceBooking(
        ['199.99'],
        [{ passengerType: ADULT, extraBagCount: 1 }],
        null,
      ),
    ).toThrow();
  });

  it('refuses an empty booking: the DTO guarantees a segment and a passenger', () => {
    expect(() => priceBooking([], [adult], null)).toThrow();
    expect(() => priceBooking(['199.99'], [], null)).toThrow();
  });
});
